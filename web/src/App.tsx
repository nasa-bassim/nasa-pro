import { comparisonSummary } from './lib/comparison';
import type { ComparisonColumn } from './lib/comparison';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { OptimumStart, Robustness } from './Decision';
import { DATA_RANGE, DAY_MS, clampT0, formatT0Input, parseT0Input, withHorizon } from './lib/ephemeris';
import { judge } from './lib/robustness';
import {
  T0_MAX,
  T0_MIN,
  initialT0Field,
  t0Commit,
  t0DaysChanged,
  t0DraftChange,
} from './lib/t0Field';
import type { T0Field } from './lib/t0Field';
import type { Ephemeris } from './lib/ephemeris';
import { eventMetric, stats, timeline } from './lib/metrics';
import { tickStepMs } from './lib/timelineTicks';
import { Moon3D } from './Moon3D';
import { SITES } from './sites';
import { copy, duration } from './i18n';
import type { Language } from './i18n';

const HOUR_MS = 3600_000;

const CUSTOM = 'custom';

interface ColumnSpec {
  id: number;
  site: string; // 큐레이션 slug 또는 'custom'
  t0: string; // datetime-local 값, UTC로 해석한다
  lat?: number; // custom 열에서 적용된 좌표
  lonE?: number;
}

// 사전 계산 열은 slug, 직접 입력 열은 좌표가 데이터 캐시 키다.
// 좌표가 아직 없는 custom 열은 null을 돌려 요청을 만들지 않는다.
function columnKey(c: ColumnSpec): string | null {
  if (c.site !== CUSTOM) return c.site;
  if (c.lat === undefined || c.lonE === undefined) return null;
  return `custom:${c.lat}:${c.lonE}`;
}

// PRD 6: 처음 열면 §2 시나리오가 로드돼 있다.
const DEFAULT_DAYS = 14;
const DEFAULT_COLUMNS: ColumnSpec[] = [
  { id: 1, site: 'im-2', t0: '2026-11-14T00:00' },
  { id: 2, site: 'im-2', t0: '2026-11-28T00:00' },
  { id: 3, site: 'im-2', t0: '2026-12-12T16:17' },
];

// 파이프라인(pipeline/terrain.py)이 만든 지형 지평선. center와 주변 12개 점(north_5 등).
interface HorizonDoc {
  points: Record<string, number[]>;
}

interface SiteData {
  status: 'error' | 'ok';
  sun?: Ephemeris;
  earth?: Ephemeris;
  horizon?: HorizonDoc; // 지형 자료가 있는 지점만
  terrain?: boolean; // sun·earth에 지형 지평선이 적용돼 있다
}

// 지형 자료는 일부 지점에만 있다. 없거나 읽지 못하면 매끈한 구로 계산한다.
async function fetchHorizon(slug: string): Promise<HorizonDoc | undefined> {
  try {
    const r = await fetch(`/horizon/${slug}.json`);
    if (!r.ok) return undefined;
    const doc = (await r.json()) as HorizonDoc;
    return doc.points?.center?.length === 360 ? doc : undefined;
  } catch {
    return undefined;
  }
}

function applyTerrain(d: SiteData, on: boolean): SiteData {
  const h = on ? d.horizon?.points.center : undefined;
  if (!d.sun || !d.earth) return d;
  return { ...d, sun: withHorizon(d.sun, h), earth: withHorizon(d.earth, h), terrain: h !== undefined };
}

// 큐레이션 열은 정적 JSON, 직접 입력 열은 /api/ephemeris 프록시(백엔드)에서 가져온다.
async function fetchSiteData(key: string): Promise<SiteData> {
  const urls = key.startsWith('custom:')
    ? (() => {
        const [, lat, lon] = key.split(':');
        const q = `lat=${lat}&lon_e=${lon}`;
        return [`/api/ephemeris?${q}&body=sun`, `/api/ephemeris?${q}&body=earth`];
      })()
    : [`/data/${key}_sun.json`, `/data/${key}_earth.json`];
  const [sun, earth] = await Promise.all(
    urls.map((u) =>
      fetch(u).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Ephemeris>;
      })
    )
  );
  const horizon = key.startsWith('custom:') ? undefined : await fetchHorizon(key);
  return { status: 'ok', sun, earth, horizon };
}

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};


function Badge({ label }: { label: string }) {
  return <span className="badge">{label}</span>;
}

// Keep the period's visual feedback separate from the expensive timeline recalculation.
const PeriodPicker = memo(function PeriodPicker({
  days,
  language,
  label,
  onChange,
}: {
  days: number;
  language: Language;
  label: string;
  onChange: (days: number) => void;
}) {
  const [pendingDays, setPendingDays] = useState<number | null>(null);
  const visualDays = pendingDays ?? days;
  const choose = (nextDays: number) => {
    if (nextDays === visualDays) return;
    setPendingDays(nextDays);
    // Two frames guarantee the selected fill is painted before metrics begin recalculating.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      onChange(nextDays);
      setPendingDays(null);
    }));
  };
  return (
    <span className="d-preset" role="group" aria-label={label}>
      {[7, 14, 28].map((d) => (
        <button
          key={d}
          className={d === visualDays ? 'active' : ''}
          aria-pressed={d === visualDays}
          onClick={() => choose(d)}
        >
          {language === 'ko' ? `${d}일` : `${d} days`}
        </button>
      ))}
    </span>
  );
});

function MetricCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="metric">
      <div className="title">{title}</div>
      <div className="value">{value}</div>
      <div className="sub">{sub ?? ''}</div>
    </div>
  );
}

function TimelineSvg({
  cells,
  times,
  rowY,
  color,
  axisStart,
  axisEnd,
  t0,
  showCursor,
  width,
  barH,
  cursorY,
}: {
  cells: boolean[];
  times: number[];
  rowY: number;
  color: string;
  axisStart: number;
  axisEnd: number;
  t0: number;
  showCursor: boolean;
  width: number;
  barH: number;
  cursorY: [number, number];
}) {
  const W = width;
  const x = (t: number) => ((t - axisStart) / (axisEnd - axisStart)) * W;
  // 1시간 칸을 따로 그리면 칸 경계마다 안티에일리어싱 줄무늬가 비친다.
  // 같은 값이 이어지는 칸은 하나의 사각형으로 합쳐 그린다.
  const runs: { start: number; end: number; v: boolean }[] = [];
  cells.forEach((v, i) => {
    const t = times[i]!;
    const last = runs[runs.length - 1];
    if (last && last.v === v && last.end === t) last.end = t + HOUR_MS;
    else runs.push({ start: t, end: t + HOUR_MS, v });
  });
  return (
    <g>
      {runs.map((r) => (
        <rect
          key={r.start}
          x={x(r.start)}
          y={rowY}
          width={x(r.end) - x(r.start)}
          height={barH}
          fill={r.v ? color : 'var(--dark)'}
          shapeRendering="crispEdges"
        />
      ))}
      {showCursor ? (
        <>
          <line x1={x(t0)} x2={x(t0)} y1={cursorY[0]} y2={cursorY[1]} stroke="var(--panel)" strokeWidth={6} />
          <line x1={x(t0)} x2={x(t0)} y1={cursorY[0]} y2={cursorY[1]} stroke="var(--cursor)" strokeWidth={2.5} />
        </>
      ) : null}
    </g>
  );
}

type Timeline = ReturnType<typeof timeline>;

function Timelines({
  tl,
  t0,
  axisStart,
  axisEnd,
  language,
}: {
  tl: Timeline;
  t0: number;
  axisStart: number;
  axisEnd: number;
  language: Language;
}) {
  const t = copy[language];
  // svg는 width:100%로 viewBox 600이 화면 폭에 맞게 축소된다. 눈금 글자가
  // 실제 렌더링 기준 11px가 되도록 표시 폭을 재서 viewBox 단위 글자 크기를 역산한다.
  const svgRef = useRef<SVGSVGElement>(null);
  const [renderedW, setRenderedW] = useState(600);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRenderedW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = renderedW > 0 ? renderedW / 600 : 1;
  const font = Math.max(11, 11 / scale);
  // 행 레이블('태양'/'지구')이 막대와 겹치지 않게 레이블 영역을 글자 크기에 맞춘다.
  const labelW = Math.max(36, 2 * font + 8);
  const W = 600 - labelW;
  const x = (t: number) => ((t - axisStart) / (axisEnd - axisStart)) * W;
  // 눈금 간격도 렌더링 px 기준으로 골라 레이블끼리 겹치지 않게 한다.
  const tickStep = tickStepMs(axisEnd - axisStart, W * scale);
  const ticks: number[] = [];
  for (let t = Math.ceil(axisStart / tickStep) * tickStep; t <= axisEnd; t += tickStep)
    ticks.push(t);
  // 낮·밤 띠가 이 화면의 주인공이라 렌더링 기준으로도 충분히 두껍게 그린다.
  const barH = Math.max(28, 22 / scale);
  const gap = 6;
  const sunY = 4;
  const earthY = sunY + barH + gap;
  const axisY = earthY + barH + gap;
  const tickTextY = axisY + 6 + font;
  const vbH = tickTextY + font * 0.4;
  return (
    <div className="timeline-wrap">
      <svg
        className="timeline"
        ref={svgRef}
        viewBox={`0 0 600 ${vbH}`}
        role="img"
        aria-label={`${t.timeline}: ${duration(tl.bothVisibleMs, language)} ${t.powerAndContact.toLowerCase()}`}
      >
        <text x={0} y={sunY + barH / 2} fontSize={font} fill="var(--muted)" dominantBaseline="central">
          {t.sunVisible}
        </text>
        <text x={0} y={earthY + barH / 2} fontSize={font} fill="var(--muted)" dominantBaseline="central">
          {t.earthVisible}
        </text>
        <g transform={`translate(${labelW},0)`}>
          {/* 공통 시간축 전체를 옅은 띠로 깔아, 이 열의 관찰 기간이 축의 어디인지 보이게 한다. */}
          <rect x={0} y={sunY} width={W} height={barH} fill="var(--track)" />
          <rect x={0} y={earthY} width={W} height={barH} fill="var(--track)" />
          <TimelineSvg
            cells={tl.sun.cells}
            times={tl.sun.times}
            rowY={sunY}
            color="var(--sunlit)"
            axisStart={axisStart}
            axisEnd={axisEnd}
            t0={t0}
            showCursor
            width={W}
            barH={barH}
            cursorY={[0, axisY]}
          />
          <TimelineSvg
            cells={tl.earth.cells}
            times={tl.earth.times}
            rowY={earthY}
            color="var(--earth)"
            axisStart={axisStart}
            axisEnd={axisEnd}
            t0={t0}
            showCursor={false}
            width={W}
            barH={barH}
            cursorY={[0, axisY]}
          />
          <line x1={0} x2={W} y1={axisY} y2={axisY} stroke="var(--border)" />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={axisY} y2={axisY + 5} stroke="var(--muted)" />
              <text x={x(t)} y={tickTextY} fontSize={font} fill="var(--muted)" textAnchor="middle">
                {fmtDate(t).slice(0, 5)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function parseCoord(raw: string, lo: number, hi: number): number | null {
  const v = Number(raw);
  return raw.trim() !== '' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

function Column({
  spec,
  index,
  best,
  days,
  data,
  loading,
  onRetry,
  onChange,
  onRemove,
  axisStart,
  axisEnd,
  language,
}: {
  spec: ColumnSpec;
  index: number;
  best: boolean;
  days: number;
  data: SiteData | undefined;
  loading: boolean;
  onRetry: () => void;
  onChange: (next: ColumnSpec) => void;
  onRemove: () => void;
  axisStart: number;
  axisEnd: number;
  language: Language;
}) {
  const isCustom = spec.site === CUSTOM;
  const site = SITES.find((s) => s.slug === spec.site);
  const t = copy[language];
  const ko = language === 'ko';

  // 직접 입력 좌표: draft는 입력 중 자유롭게, 적용 버튼에서만 검증 후 요청한다.
  const [latDraft, setLatDraft] = useState(spec.lat?.toString() ?? '');
  const [lonDraft, setLonDraft] = useState(spec.lonE?.toString() ?? '');
  const [coordError, setCoordError] = useState<string | null>(null);

  const applyCoords = () => {
    const lat = parseCoord(latDraft, -90, 90);
    const lon = parseCoord(lonDraft, -360, 360);
    if (lat === null) {
      setCoordError(t.latitudeError);
      return;
    }
    if (lon === null) {
      setCoordError(t.longitudeError);
      return;
    }
    setCoordError(null);
    onChange({ ...spec, lat, lonE: lon });
  };

  // PRD 6: 범위 밖이면 알리고 범위 안 값으로 되돌린다. 단, 편집 중인 draft는
  // 리셋하지 않는다 — 범위 안 완전값만 즉시 적용하고, 나머지는 blur/Enter에서
  // 커밋한다 (연도 입력이 첫 자리에서 clamp되는 회귀 수정). 판정은 lib/t0Field.
  const [field, setField] = useState<T0Field>(initialT0Field);
  const lastApplied = useRef(spec.t0);

  // applied(외부 리셋 포함)나 D가 바뀌면 한 effect에서 필드를 다시 판정한다.
  // apply 여부는 applied·days만으로 결정되므로, 같은 커밋에서 렌더 시점의
  // 오래된 field로 warn을 되살리는 일이 없다.
  useEffect(() => {
    const external = spec.t0 !== lastApplied.current;
    if (external) lastApplied.current = spec.t0;
    const d = t0DaysChanged(initialT0Field(), spec.t0, days);
    if (d.apply !== null) {
      lastApplied.current = d.apply;
      onChange({ ...spec, t0: d.apply });
      setField(d.field);
    } else if (external) {
      setField(initialT0Field());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.t0, days]);

  const appliedT0 = spec.t0; // 항상 canonical·clamp된 값
  const t0 = parseT0Input(appliedT0);

  const applyDecision = (raw: string) => {
    const d = t0DraftChange(field, raw, days);
    setField(d.field);
    if (d.apply !== null) {
      lastApplied.current = d.apply;
      onChange({ ...spec, t0: d.apply });
    }
  };

  const commit = () => {
    const d = t0Commit(field, spec.t0, days);
    setField(d.field);
    if (d.apply !== null) {
      lastApplied.current = d.apply;
      onChange({ ...spec, t0: d.apply });
    }
  };

  return (
    <div className="column">
      <div className="column-head">
        <span className="col-no" aria-hidden="true">
          {index}
        </span>
        <h2 className="sr-only">
          {ko ? `${index}번째 후보지` : `Scenario ${index}`}, {isCustom ? t.customCoordinates : site?.name}
        </h2>
        <select
          className="site-select"
          value={spec.site}
          onChange={(e) => onChange({ ...spec, site: e.target.value })}
          aria-label={t.site}
        >
          {SITES.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
          <option value={CUSTOM}>{t.customCoordinates}</option>
        </select>
        <button
          className="remove"
          data-remove-col={spec.id}
          onClick={onRemove}
          aria-label={t.removeScenario}
        >
          ×
        </button>
      </div>
      <div className="coords">
        <span>
          {isCustom && spec.lat !== undefined && spec.lonE !== undefined
            ? (ko ? `위도 ${spec.lat}°, 동경 ${spec.lonE}°` : `Lat ${spec.lat}°, E ${spec.lonE}°`)
            : !isCustom && site
              ? (ko ? `위도 ${site.lat}°, 동경 ${site.lon_e}°` : `Lat ${site.lat}°, E ${site.lon_e}°`)
              : t.coordinatesMissing}
        </span>
        {!isCustom && site ? (
          <a className="source" href={site.sourceUrl}>
            {t.coordinateSource}
          </a>
        ) : null}
        <Badge label={data?.terrain ? t.terrainIncluded : t.terrainNotIncluded} />
      </div>
      <label className="controls">
        <span className="t0-label">{t.landingStart}</span>
        <input
          type="datetime-local"
          value={field.draft ?? appliedT0}
          step={60}
          min={T0_MIN}
          max={T0_MAX}
          onChange={(e) => applyDecision(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          aria-label={t.landingStart}
        />
      </label>
      {field.warn ? <div className="warn">{t.rangeWarning}</div> : null}
      {isCustom ? (
        <form
          noValidate
          className="custom-coords"
          onSubmit={(e) => {
            e.preventDefault();
            applyCoords();
          }}
        >
          <label>
            {t.latitude}{' '}
            <input
              type="number"
              step="any"
              min={-90}
              max={90}
              value={latDraft}
              onChange={(e) => {
                setLatDraft(e.target.value);
                setCoordError(null);
              }}
              aria-label={t.latitude}
            />
          </label>{' '}
          <label>
            {t.longitude}{' '}
            <input
              type="number"
              step="any"
              min={-360}
              max={360}
              value={lonDraft}
              onChange={(e) => {
                setLonDraft(e.target.value);
                setCoordError(null);
              }}
              aria-label={t.longitude}
            />
          </label>{' '}
          <button type="submit">{t.apply}</button>
          {coordError ? <div className="warn">{coordError}</div> : null}
        </form>
      ) : null}

      {isCustom && spec.lat === undefined ? (
        <div className="state-box">{t.coordinatesPrompt}</div>
      ) : loading || !data ? (
        <div className="state-box">
          {t.loadingData}
          {isCustom ? <div className="sub">{t.firstRequestNote}</div> : null}
        </div>
      ) : data.status === 'error' ? (
        <div className="state-box">
          {t.dataError} <button onClick={onRetry}>{t.retry}</button>
        </div>
      ) : (
        <ColumnBody
          best={best}
          language={language}
          sun={data.sun!}
          earth={data.earth!}
          t0={t0}
          days={days}
          axisStart={axisStart}
          axisEnd={axisEnd}
          lat={isCustom ? spec.lat! : site!.lat}
          lonE={isCustom ? spec.lonE! : site!.lon_e}
          neighbourHorizons={data.terrain ? data.horizon?.points : undefined}
          onApplyT0={(ms) => onChange({ ...spec, t0: formatT0Input(ms) })}
        />
      )}
    </div>
  );
}

function ColumnBody({
  best,
  language,
  sun,
  earth,
  t0,
  days,
  axisStart,
  axisEnd,
  lat,
  lonE,
  neighbourHorizons,
  onApplyT0,
}: {
  lat: number;
  lonE: number;
  neighbourHorizons: Record<string, number[]> | undefined;
  onApplyT0: (ms: number) => void;
  best: boolean;
  language: Language;
  sun: Ephemeris;
  earth: Ephemeris;
  t0: number;
  days: number;
  axisStart: number;
  axisEnd: number;
}) {
  const t = copy[language];
  const nextSun = eventMetric(sun, t0, 'sun');
  const nextEarth = eventMetric(earth, t0, 'earth');
  const sunStats = stats(sun, t0, days);
  const earthStats = stats(earth, t0, days);

  const card = (m: typeof nextSun) =>
    m.text !== null
      ? { value: m.text }
      : { value: `${m.days!.toFixed(1)}${language === 'ko' ? '일' : ' days'}`, sub: m.eventTime ? fmtDate(m.eventTime) : undefined };

  const tl = timeline(sun, earth, t0, days);
  const overlapPercent = Math.round(tl.bothVisibleMs / (days * DAY_MS) * 100);
  // 오차 평가(Robustness)와 같은 임무 조건으로 판단한다.
  const isViable = judge(sun, earth, t0, days).ok;
  const status = isViable
    ? { label: t.goodFirstChoice, detail: t.goodFirstChoiceDetail }
    : overlapPercent > 0
      ? { label: t.needsReview, detail: t.needsReviewDetail }
      : { label: t.notRecommended, detail: t.notRecommendedDetail };

  return (
    <>
      <div className={`readiness readiness-${isViable ? 'go' : overlapPercent > 0 ? 'caution' : 'stop'}`}>
        <div>
          <span className="readiness-kicker">{t.scenarioStatus}</span>
          <strong>{status.label}</strong>
        </div>
        <p>{status.detail}</p>
      </div>
      <div className="lead">
        <div className="lead-label">
          {t.powerAndContact}
          {best ? <span className="best">{t.best}</span> : null}
        </div>
        <div className="lead-value">
          {duration(tl.bothVisibleMs, language)}
          <span className="lead-of">{language === 'ko' ? `${days}일 중 ${overlapPercent}%` : `${overlapPercent}% of ${days} days`}</span>
        </div>
        <div className="overlap-meter" role="meter" aria-label={t.powerAndContact} aria-valuenow={overlapPercent} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${overlapPercent}%` }} />
        </div>
        <p className="metric-explanation">{t.powerAndContactHelp}</p>
        <OptimumStart language={language} sun={sun} earth={earth} days={days} currentMs={tl.bothVisibleMs} onApply={onApplyT0} />
      </div>
      <div className={`darkness-summary${sunStats.longestDarkHours > 0 ? ' has-darkness' : ''}`}>
        <span>{t.longestDarkness}</span>
        <strong>{duration(sunStats.longestDarkHours * HOUR_MS, language)}</strong>
        <p>{sunStats.longestDarkHours > 0 ? t.darknessHelp : t.noDarknessHelp}</p>
      </div>
      <div className="availability-pair">
        <div><span>{t.sunlightTime}</span><strong>{Math.round(sunStats.fraction * 100)}%</strong><div className="mini-track"><i style={{width: `${sunStats.fraction * 100}%`, background: 'var(--sunlit)'}} /></div></div>
        <div><span>{t.earthContactTime}</span><strong>{Math.round(earthStats.fraction * 100)}%</strong><div className="mini-track"><i style={{width: `${earthStats.fraction * 100}%`, background: 'var(--earth)'}} /></div></div>
      </div>
      <Robustness language={language} lat={lat} lonE={lonE} neighbourHorizons={neighbourHorizons} sun={sun} earth={earth} t0={t0} days={days} />
      <p className="timeline-heading">{t.timeline} <span>{t.timelineHelp}</span></p>
      <Timelines tl={tl} t0={t0} axisStart={axisStart} axisEnd={axisEnd} language={language} />
      <details className="secondary-metrics">
        <summary>{t.nextEvents}</summary>
      <div className="metric-grid">
        <MetricCard title={nextSun.title} {...card(nextSun)} />
        <MetricCard title={nextEarth.title} {...card(nextEarth)} />
        <MetricCard
          title={t.maxSunElevation}
          value={
            sunStats.maxElevationAboveHorizon === null
              ? t.noSunlight
              : `${sunStats.maxElevationAboveHorizon.toFixed(1)}°`
          }
        />
      </div>
      </details>
    </>
  );
}

let nextId = 10;

export default function App() {
  const [columns, setColumns] = useState<ColumnSpec[]>(DEFAULT_COLUMNS);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [rawData, setData] = useState<Record<string, SiteData>>({});
  const [terrain, setTerrain] = useState(true);
  // 화면과 계산은 지형 반영 여부를 적용한 data만 본다.
  const data = useMemo(
    () => Object.fromEntries(Object.entries(rawData).map(([k, d]) => [k, applyTerrain(d, terrain)])),
    [rawData, terrain]
  );
  const [retries, setRetries] = useState<Record<string, number>>({});
  const [newSite, setNewSite] = useState(SITES[0]!.slug);
  const [language, setLanguage] = useState<Language>(() => {
    const saved = window.localStorage.getItem('lunar-navigator-language');
    return saved === 'en' ? 'en' : 'ko';
  });
  const [selectedId, setSelectedId] = useState(DEFAULT_COLUMNS[0]!.id);
  const [showComparison, setShowComparison] = useState(false);
  const [workspaceSection, setWorkspaceSection] = useState<'setup' | 'results'>('setup');
  const [view, setView] = useState<'landing' | 'workspace'>(() =>
    window.location.hash === '#workspace' ? 'workspace' : 'landing'
  );

  // 열 제거 버튼이나 예시 복원 버튼이 사라져도 포커스가 body로 떨어지지 않게,
  // 사라진 뒤 옮길 대상(다음/이전 열의 제거 버튼, 복원 버튼, 첫 열 지점 선택)을
  // 기억해 둔다.
  const pendingFocus = useRef<number | 'restore' | 'site' | null>(null);
  const removeColumn = (id: number) => {
    const idx = columns.findIndex((x) => x.id === id);
    const next = columns.filter((x) => x.id !== id);
    const nextSelected = next[idx] ?? next[idx - 1];
    if (selectedId === id && nextSelected) setSelectedId(nextSelected.id);
    pendingFocus.current = next.length === 0 ? 'restore' : nextSelected!.id;
    setColumns(next);
  };
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    const sel =
      target === 'restore'
        ? '[data-restore]'
        : target === 'site'
          ? '.decision-board [aria-label="착륙 후보지"], .decision-board [aria-label="Landing site"]'
          : `[data-remove-col="${target}"]`;
    document.querySelector<HTMLElement>(sel)?.focus();
  }, [columns]);

  const needed = useMemo(
    () => [...new Set(columns.map(columnKey).filter((k): k is string => k !== null))],
    [columns]
  );
  const inflight = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const key of needed) {
      if (data[key] !== undefined || inflight.current.has(key)) continue;
      inflight.current.add(key);
      fetchSiteData(key)
        .then((d) => setData((prev) => ({ ...prev, [key]: d })))
        .catch(() => setData((prev) => ({ ...prev, [key]: { status: 'error' } })))
        .finally(() => inflight.current.delete(key));
    }
  }, [needed, data, retries]);

  // 공통 시간축: 모든 열의 [t0, t0+D)를 덮는 최소 구간 (PRD 6).
  const { axisStart, axisEnd } = useMemo(() => {
    if (columns.length === 0) return { axisStart: DATA_RANGE.start, axisEnd: DATA_RANGE.start + DAY_MS };
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of columns) {
      const t0 = clampT0(parseT0Input(c.t0), days);
      lo = Math.min(lo, t0);
      hi = Math.max(hi, t0 + days * DAY_MS);
    }
    return { axisStart: lo, axisEnd: hi };
  }, [columns, days]);

  // 화면의 질문에 대한 답: 태양과 지구가 함께 보이는 시간이 가장 긴 열.
  // 각 열이 그리는 값과 같은 timeline()에서 계산해 두 곳의 숫자가 어긋나지 않게 한다.
  const comparison = useMemo(() => {
    const states: ComparisonColumn[] = columns.map((c, i) => {
      const no = i + 1;
      const key = columnKey(c);
      if (key === null) return { no, status: 'missing' };
      const d = data[key];
      if (!d) return { no, status: 'loading' };
      if (d.status === 'error' || !d.sun || !d.earth) return { no, status: 'error' };
      return { no, status: 'ready', ms: timeline(d.sun, d.earth, parseT0Input(c.t0), days).bothVisibleMs };
    });
    return comparisonSummary(states, days);
  }, [columns, data, days]);
  const bestNos = comparison.bestNos;

  const readyCount = columns.filter((c) => {
    const key = columnKey(c);
    const d = key === null ? undefined : data[key];
    return d?.status === 'ok' && d.sun && d.earth;
  }).length;
  const comparisonReady = columns.length >= 2 && readyCount === columns.length;
  const canAdd = columns.length < 4;
  const addColumn = (site: string) =>
    setColumns((c) => {
      if (c.length >= 4) return c;
      const added = { id: nextId++, site, t0: '2026-11-14T00:00' };
      setSelectedId(added.id);
      return [...c, added];
    });
  const selectedIndex = Math.max(0, columns.findIndex((c) => c.id === selectedId));
  const selectedColumn = columns[selectedIndex];
  const selectedKey = selectedColumn ? columnKey(selectedColumn) : null;
  const ko = language === 'ko';
  const text = copy[language];
  const changeLanguage = () => setLanguage((value) => value === 'ko' ? 'en' : 'ko');
  useEffect(() => {
    window.localStorage.setItem('lunar-navigator-language', language);
    document.documentElement.lang = language;
  }, [language]);
  const navigate = (next: 'landing' | 'workspace') => {
    setView(next);
    if (next === 'workspace') setWorkspaceSection('setup');
    const hash = next === 'workspace' ? '#workspace' : '#home';
    window.history.pushState({ view: next }, '', hash);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  useEffect(() => {
    const onPopState = () => setView(window.location.hash === '#workspace' ? 'workspace' : 'landing');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <>
      {view === 'landing' ? (
        <main className="landing-page">
          <nav className="landing-nav" aria-label={text.navigation}>
            <div className="landing-brand">
              <span className="brand-orbit" aria-hidden="true" />
              <span>LUNAR NAVIGATOR</span>
            </div>
            <div className="nav-actions"><button className="language-switch" onClick={changeLanguage}>{text.languageSwitch}</button></div>
          </nav>
          <section className="landing-hero">
            <div className="landing-copy">
              <span className="landing-eyebrow">{text.landingEyebrow}</span>
              <h1>{text.landingTitle.split('\n').map((line, index) => <span key={line}>{index > 0 ? <br /> : null}{line}</span>)}</h1>
              <p>{text.landingLead}</p>
              <div className="landing-actions">
                <button className="landing-primary" onClick={() => navigate('workspace')}>{text.landingCta} <span aria-hidden="true">→</span></button>
              </div>
            </div>
            <div className="landing-moon-panel">
              <Moon3D columns={columns} canAdd={false} onAdd={() => undefined} language={language} />
              <div className="landing-moon-caption"><span>{text.landingCaption}</span><span>{text.landingExplore}</span></div>
            </div>
          </section>
        </main>
      ) : (
        <main className="workspace-page">
          <nav className="workspace-nav" aria-label={text.workspaceNavigation}>
            <button className="workspace-brand" onClick={() => navigate('landing')}><span className="brand-orbit" aria-hidden="true" /> LUNAR NAVIGATOR</button>
            <span className="workspace-label">SCENARIO WORKSPACE</span>
            <div className="nav-actions"><button className="language-switch" onClick={changeLanguage}>{text.languageSwitch}</button><button className="workspace-back" onClick={() => navigate('landing')}>← {text.backHome}</button></div>
          </nav>
          <div className="workspace-flow" role="navigation" aria-label={text.workspaceNavigation}>
            <button className={workspaceSection === 'setup' ? 'is-active' : ''} aria-pressed={workspaceSection === 'setup'} onClick={() => setWorkspaceSection('setup')}>{text.setupKicker}</button>
            <span aria-hidden="true" />
            <button className={workspaceSection === 'results' ? 'is-active' : ''} aria-pressed={workspaceSection === 'results'} onClick={() => setWorkspaceSection('results')}>{text.resultsKicker}</button>
          </div>
      {workspaceSection === 'setup' ? <header className="hero">
        <div className="hero-text">
          <div className="product">
            <div>
              <h1>{text.heroTitle}</h1>
            </div>
          </div>
          <p className="intro">{text.heroLead}</p>
          <div className={`comparison-status${comparisonReady ? ' is-ready' : ''}`} role="status" aria-live="polite" aria-atomic="true">
            <div className="status-heading">
              <span>{comparisonReady ? text.currentRecommendation : text.calculating}</span>
              <span className="ready-count">{columns.length}{text.selectedCandidates}</span>
            </div>
            {comparisonReady && comparison.ms !== null ? (
              <div className="recommendation-summary">
                <div className="recommendation-candidates">
                  <span>{text.recommendedCandidates}</span>
                  <div>
                    {comparison.columns.map((no) => <b key={no}>{ko ? `${no}번` : `#${no}`}</b>)}
                  </div>
                </div>
                <div className="recommendation-time">
                  <span>{text.simultaneousVisible}</span>
                  <strong>{duration(comparison.ms, language)}</strong>
                </div>
                <div className="recommendation-meta">
                  <span>{text.observationWindow} <b>{ko ? `${comparison.days}일` : `${comparison.days} days`}</b></span>
                  <p>{comparison.state === 'tie' ? text.recommendationTie : text.recommendationBasis}</p>
                </div>
              </div>
            ) : (
              <p className="summary-pending">
                {comparison.state === 'empty' ? text.comparisonEmpty : comparison.state === 'single' ? text.comparisonSingle : text.comparisonLoading}
              </p>
            )}
          </div>

          <div className="scenario-bar">
            <div className="bar-row">
              <span className="d-label">{text.window}</span>
              <PeriodPicker days={days} language={language} label={text.durationGroup} onChange={setDays} />
            </div>
            <div className="bar-row">
              <select
                value={newSite}
                onChange={(e) => setNewSite(e.target.value)}
                aria-label={text.siteToAdd}
              >
                {SITES.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
                <option value={CUSTOM}>{text.customCoordinates}</option>
              </select>
              <button className="primary" disabled={!canAdd} onClick={() => addColumn(newSite)}>
                {text.addSite}
              </button>
              <button
                onClick={() => {
                  setColumns(DEFAULT_COLUMNS);
                  setDays(DEFAULT_DAYS);
                }}
              >
                {text.reset}
              </button>
            </div>
          </div>

          <aside className="data-note" aria-label={text.dataNote}>{text.dataNote}</aside>
          <button className="view-results primary" onClick={() => setWorkspaceSection('results')}>{text.viewResults}</button>
        </div>
        <Moon3D columns={columns} canAdd={canAdd} onAdd={addColumn} language={language} />
      </header> : <>

      <div className="comparison-heading">
        <div><span className="section-kicker">{text.results}</span><h2>{text.resultTitle}</h2><p>{text.resultLead}</p></div>
        <div className="visibility-legend" aria-label={text.legend}>
          <span><i className="legend-sun" />{text.sunVisible}</span>
          <span><i className="legend-earth" />{text.earthVisible}</span>
          <span><i className="legend-dark" />{text.notVisible}</span>
          <label className="terrain-toggle">
            <input type="checkbox" checked={terrain} onChange={(e) => setTerrain(e.target.checked)} />
            {text.terrainToggle}
          </label>
        </div>
      </div>
      {columns.length === 0 ? (
        <div className="state-box">
          <p>{text.chooseSite}</p>
          <button
            data-restore
            onClick={() => {
              // 버튼이 사라지므로 복원 후 첫 열 지점 선택으로 포커스를 옮긴다.
              pendingFocus.current = 'site';
              setColumns(DEFAULT_COLUMNS);
              setDays(DEFAULT_DAYS);
            }}
          >
            {text.restoreExamples}
          </button>
        </div>
      ) : (
        <section className="decision-board" aria-label={text.results}>
          <div className="scenario-tabs" role="tablist" aria-label={text.results}>
            {columns.map((c, i) => {
              const site = SITES.find((item) => item.slug === c.site);
              const key = columnKey(c);
              const record = key ? data[key] : undefined;
              const ready = record?.status === 'ok' && record.sun && record.earth;
              const score = ready ? Math.round(timeline(record.sun!, record.earth!, parseT0Input(c.t0), days).bothVisibleMs / (days * DAY_MS) * 100) : null;
              return <button key={c.id} role="tab" aria-selected={c.id === selectedColumn?.id} className={`scenario-tab${c.id === selectedColumn?.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(c.id)}>
                <span>{ko ? `${i + 1}번째 후보지` : `${text.scenario} ${i + 1}`}</span>
                <strong>{c.site === CUSTOM ? text.customSite : site?.name}</strong>
                <small>{score === null ? text.calculating : (ko ? `${text.ready} ${score}%` : `${score}% ${text.ready}`)}</small>
              </button>;
            })}
          </div>
          <div className="board-actions"><button onClick={() => setShowComparison((value) => !value)}>{showComparison ? text.backToDetails : text.compareNumbers}</button></div>
          {showComparison ? (
            <div className="comparison-table" role="region" aria-label={text.compareNumbers}>
              <div className="table-head"><span>{text.tableSite}</span><span>{text.tablePowerContact}</span><span>{text.tableLongestDark}</span></div>
              {columns.map((c) => {
                const site = SITES.find((item) => item.slug === c.site);
                const key = columnKey(c); const record = key ? data[key] : undefined;
                if (!record?.sun || !record.earth) return <div className="table-row" key={c.id}><strong>{site?.name ?? text.customSite}</strong><span>{text.calculating}</span><span>–</span></div>;
                const tl = timeline(record.sun, record.earth, parseT0Input(c.t0), days);
                const sunStats = stats(record.sun, parseT0Input(c.t0), days);
                return <button className="table-row" key={c.id} onClick={() => { setSelectedId(c.id); setShowComparison(false); }}><strong>{site?.name ?? text.customSite}</strong><span>{duration(tl.bothVisibleMs, language)}</span><span>{duration(sunStats.longestDarkHours * HOUR_MS, language)}</span></button>;
              })}
            </div>
          ) : selectedColumn ? (
            <div className="selected-scenario">
              <div className="selected-scenario-label"><span>{text.selectedDetail}</span><strong>{ko ? `${selectedIndex + 1}번째 후보지` : `${text.scenario} ${selectedIndex + 1}`}</strong></div>
              <Column
                key={selectedColumn.id}
                spec={selectedColumn}
                index={selectedIndex + 1}
                best={bestNos.has(selectedIndex + 1)}
                days={days}
                data={selectedKey === null ? undefined : data[selectedKey]}
                loading={selectedKey !== null && data[selectedKey] === undefined}
                onRetry={() => {
                  if (selectedKey === null) return;
                  setData((d) => { const next = { ...d }; delete next[selectedKey]; return next; });
                  setRetries((r) => ({ ...r, [selectedKey]: (r[selectedKey] ?? 0) + 1 }));
                }}
                onChange={(next) => setColumns((cs) => cs.map((x) => (x.id === selectedColumn.id ? next : x)))}
                onRemove={() => removeColumn(selectedColumn.id)}
                axisStart={axisStart}
                axisEnd={axisEnd}
                language={language}
              />
            </div>
          ) : null}
        </section>
      )}

      <div className="results-actions"><button onClick={() => setWorkspaceSection('setup')}>{text.backToSetup}</button></div>
      <div className="footnote">
        {text.footnote}
        <br />
        {text.moonSource}{' '}
        <a href="https://svs.gsfc.nasa.gov/4720">NASA SVS CGI Moon Kit</a> (LROC color map, LOLA elevation).
        {text.southPoleSource}{' '}
        <a href="https://commons.wikimedia.org/wiki/File:LRO_WAC_South_Pole_Mosaic.jpg">
          LRO WAC South Pole Mosaic
        </a>
        , NASA/GSFC/Arizona State University. {text.publicDomain}
      </div>
      </>}
        </main>
      )}
    </>
  );
}
