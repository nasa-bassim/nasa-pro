// 의사결정 도구 두 가지: 가장 유리한 시작 시각 찾기, 위치·일정 오차 견고성 평가.
import { useMemo, useState } from 'react';

import './decision.css';
import { duration } from './i18n';
import type { Language } from './i18n';
import { bestStart } from './lib/bestStart';
import { DAY_MS, formatT0Input, withHorizon } from './lib/ephemeris';
import type { Ephemeris } from './lib/ephemeris';
import {
  BEARING,
  DIRECTIONS,
  MISSION,
  SCHEDULE_STEPS,
  evaluate,
  offsetCoord,
  summarize,
} from './lib/robustness';
import type { Cell, Direction, PointData, Summary } from './lib/robustness';

const HOUR_MS = 3600_000;

const copy = {
  ko: {
    optimumNow: '이 지점에서는 지금 시작 시각이 계산 범위에서 가장 유리합니다.',
    optimum: (when: string, total: string, gain: string) =>
      [`가장 유리한 시작은 `, `${when} UTC`, `입니다. 동시 가시가 ${total}으로, 지금보다 ${gain} 깁니다.`] as const,
    applyOptimum: '이 시각으로 시작',
    title: '오차가 생겨도 괜찮을까요?',
    help: '착륙 위치와 일정이 계획에서 벗어난 경우까지 같은 임무 조건으로 다시 평가합니다.',
    conditions: `임무 조건: 동시 가시 ${MISSION.minOverlapPercent}% 이상 · 연속 암흑 ${MISSION.maxDarkHours}시간 이하`,
    position: '위치 오차',
    schedule: '일정 오차',
    days: (n: number) => `±${n}일`,
    km: (n: number) => `±${n}km`,
    evaluatePosition: '위치 오차까지 평가',
    positionNote: '주변 4개 지점의 궤도 데이터를 NASA Horizons에서 받아옵니다. 처음에는 30초쯤 걸릴 수 있습니다.',
    loading: (done: number) => `주변 지점 데이터를 받는 중 (${done}/4)`,
    error: '주변 지점 데이터를 받지 못했습니다. 백엔드 서버가 켜져 있는지 확인하세요.',
    retry: '다시 시도',
    baselineFails: '기준 계획(기준점·예정 시각)이 이미 임무 조건을 만족하지 않습니다.',
    allPass: (n: number) => `지정한 위치·일정 오차 범위에서 평가한 ${n}개 조합이 모두 임무 조건을 만족합니다.`,
    allPassScheduleOnly: (n: number) =>
      `지정한 일정 오차 범위에서 평가한 ${n}개 시각이 모두 임무 조건을 만족합니다. 위치 오차는 아직 평가하지 않았습니다.`,
    dir: { center: '기준점', north: '북쪽', south: '남쪽', east: '동쪽', west: '서쪽' } as Record<Direction, string>,
    planned: '예정',
    hours: (h: number) => `${h}시간`,
    dayUnit: (d: string) => `${d}일`,
    ok: '충족',
    dark: (h: number) => `암흑 ${h.toFixed(1)}시간`,
    overlap: (p: number) => `가시 ${p.toFixed(1)}%`,
    outOfRange: '계산 범위 밖',
    tableLabel: '위치와 일정 오차별 임무 조건 충족 여부',
    rowHead: '위치 \\ 일정',
  },
  en: {
    optimumNow: 'For this site, the current start time is already the best in the computed range.',
    optimum: (when: string, total: string, gain: string) =>
      [`The best start is `, `${when} UTC`, `: ${total} of simultaneous visibility, ${gain} more than now.`] as const,
    applyOptimum: 'Start at this time',
    title: 'Does it survive errors?',
    help: 'Re-checks the same mission conditions when the landing position and schedule drift from the plan.',
    conditions: `Mission conditions: overlap ≥ ${MISSION.minOverlapPercent}% · continuous darkness ≤ ${MISSION.maxDarkHours} h`,
    position: 'Position error',
    schedule: 'Schedule error',
    days: (n: number) => `±${n} d`,
    km: (n: number) => `±${n} km`,
    evaluatePosition: 'Include position error',
    positionNote: 'Fetches ephemerides for four nearby points from NASA Horizons. The first run can take about 30 seconds.',
    loading: (done: number) => `Fetching nearby points (${done}/4)`,
    error: 'Could not fetch nearby points. Check that the backend server is running.',
    retry: 'Retry',
    baselineFails: 'The baseline plan (nominal point, planned time) already fails the mission conditions.',
    allPass: (n: number) => `All ${n} combinations within the position and schedule error range meet the mission conditions.`,
    allPassScheduleOnly: (n: number) =>
      `All ${n} start times within the schedule error range meet the mission conditions. Position error is not evaluated yet.`,
    dir: { center: 'Nominal', north: 'North', south: 'South', east: 'East', west: 'West' } as Record<Direction, string>,
    planned: 'Planned',
    hours: (h: number) => `${h} h`,
    dayUnit: (d: string) => `${d} d`,
    ok: 'OK',
    dark: (h: number) => `Dark ${h.toFixed(1)}h`,
    overlap: (p: number) => `Overlap ${p.toFixed(1)}%`,
    outOfRange: 'Outside computed range',
    tableLabel: 'Mission conditions by position and schedule error',
    rowHead: 'Position \\ Schedule',
  },
};

export function OptimumStart({
  language,
  sun,
  earth,
  days,
  currentMs,
  onApply,
}: {
  language: Language;
  sun: Ephemeris;
  earth: Ephemeris;
  days: number;
  currentMs: number; // 지금 시작 시각의 동시 가시 시간
  onApply: (t0: number) => void;
}) {
  const t = copy[language];
  const optimum = useMemo(() => bestStart(sun, earth, days), [sun, earth, days]);
  if (optimum === null) return null;
  const gain = optimum.bothVisibleMs - currentMs;
  if (gain <= 0) return <p className="optimum">{t.optimumNow}</p>;
  const [a, when, b] = t.optimum(
    formatT0Input(optimum.t0).replace('T', ' '),
    duration(optimum.bothVisibleMs, language),
    duration(gain, language),
  );
  return (
    <div className="optimum">
      <p>
        {a}
        <strong>{when}</strong>
        {b}
      </p>
      <button onClick={() => onApply(optimum.t0)}>{t.applyOptimum}</button>
    </div>
  );
}

// 주변 지점 궤도 데이터. 같은 좌표는 한 번만 받는다.
const pointCache = new Map<string, Promise<PointData>>();
function fetchPoint(lat: number, lonE: number): Promise<PointData> {
  const q = `lat=${lat.toFixed(4)}&lon_e=${lonE.toFixed(4)}`;
  const cached = pointCache.get(q);
  if (cached) return cached;
  const get = (body: 'earth' | 'sun') =>
    fetch(`/api/ephemeris?${q}&body=${body}`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<Ephemeris>;
    });
  const p = Promise.all([get('sun'), get('earth')]).then(([sun, earth]) => ({ sun, earth }));
  pointCache.set(q, p);
  p.catch(() => pointCache.delete(q));
  return p;
}

type Neighbours =
  | { key: string; status: 'loading'; done: number }
  | { key: string; status: 'error' }
  | { key: string; status: 'ok'; points: Partial<Record<Direction, PointData>> };

function verdictSentence(s: Summary, withPosition: boolean, language: Language): string {
  const t = copy[language];
  if (!s.baselineOk) return t.baselineFails;
  if (s.failed === 0) return withPosition ? t.allPass(s.evaluated) : t.allPassScheduleOnly(s.evaluated);
  const dirs = s.failDirs.map((d) => t.dir[d]);
  if (language === 'ko') {
    const parts = [
      dirs.length === 4 ? '어느 방향으로든 벗어나' : dirs.length > 0 ? `${dirs.join('·')}으로 벗어나` : null,
      s.late && s.early ? '일정이 어긋나' : s.late ? '일정이 늦어지' : s.early ? '일정이 당겨지' : null,
    ].filter((p): p is string => p !== null);
    const cond = parts.length > 0 ? `${parts.join('거나 ')}면` : '위치와 일정이 함께 어긋나면';
    const reason =
      s.reasons.length === 2
        ? '암흑 허용치를 넘거나 동시 가시 시간이 부족합니다'
        : s.reasons[0] === 'dark'
          ? '암흑 허용치를 초과합니다'
          : '동시 가시 시간이 부족합니다';
    return `기준 계획은 조건을 만족하지만, ${cond} ${reason}. (${s.evaluated}개 중 ${s.failed}개 불만족)`;
  }
  const parts = [
    dirs.length === 4 ? 'the landing drifts in any direction' : dirs.length > 0 ? `the landing drifts ${dirs.join(' or ').toLowerCase()}` : null,
    s.late && s.early ? 'the schedule shifts' : s.late ? 'the schedule slips' : s.early ? 'the schedule moves earlier' : null,
  ].filter((p): p is string => p !== null);
  const cond = parts.length > 0 ? parts.join(' or ') : 'position and schedule drift together';
  const reason =
    s.reasons.length === 2
      ? 'the darkness limit is exceeded or the overlap is too short'
      : s.reasons[0] === 'dark'
        ? 'the darkness limit is exceeded'
        : 'the overlap is too short';
  return `The baseline plan passes, but if ${cond}, ${reason}. (${s.failed} of ${s.evaluated} fail)`;
}

function offsetLabel(dtMs: number, language: Language): string {
  const t = copy[language];
  if (dtMs === 0) return t.planned;
  const hours = Math.abs(dtMs) / HOUR_MS;
  const sign = dtMs > 0 ? '+' : '−';
  if (hours < 24) return sign + t.hours(hours);
  const d = hours / 24;
  return sign + t.dayUnit(Number.isInteger(d) ? String(d) : d.toFixed(1));
}

function cellText(c: Cell, language: Language): string {
  const t = copy[language];
  if (c.verdict === null) return '–';
  if (c.verdict.ok) return '✓';
  return c.verdict.reasons.includes('dark') ? t.dark(c.verdict.darkHours) : t.overlap(c.verdict.overlapPercent);
}

function cellTitle(c: Cell, language: Language): string {
  const t = copy[language];
  if (c.verdict === null) return t.outOfRange;
  return `${c.verdict.ok ? t.ok : ''} ${t.overlap(c.verdict.overlapPercent)} · ${t.dark(c.verdict.darkHours)}`.trim();
}

const KM_CHOICES = [5, 10, 20] as const;
const DAY_CHOICES = [1, 2, 3] as const;

export function Robustness({
  language,
  lat,
  lonE,
  neighbourHorizons,
  sun,
  earth,
  t0,
  days,
}: {
  language: Language;
  lat: number;
  lonE: number;
  // 지형을 반영할 때 주변 점의 지평선(north_5 등). 없으면 주변 점은 매끈한 구.
  neighbourHorizons: Record<string, number[]> | undefined;
  sun: Ephemeris;
  earth: Ephemeris;
  t0: number;
  days: number;
}) {
  const t = copy[language];
  const [km, setKm] = useState<(typeof KM_CHOICES)[number]>(10);
  const [scheduleDays, setScheduleDays] = useState<(typeof DAY_CHOICES)[number]>(1);
  const [state, setState] = useState<Neighbours | null>(null);

  // 지점이나 반경이 바뀌면 이전 결과는 쓰지 않는다.
  const key = `${lat}:${lonE}:${km}`;
  const neighbours = state?.key === key ? state : null;

  const load = () => {
    setState({ key, status: 'loading', done: 0 });
    void (async () => {
      const points: Partial<Record<Direction, PointData>> = {};
      try {
        let done = 0;
        for (const dir of ['north', 'south', 'east', 'west'] as const) {
          const p = offsetCoord(lat, lonE, BEARING[dir], km);
          points[dir] = await fetchPoint(p.lat, p.lonE);
          done += 1;
          const progress = done;
          setState((s) => (s?.key === key && s.status === 'loading' ? { key, status: 'loading', done: progress } : s));
        }
        setState((s) => (s?.key === key ? { key, status: 'ok', points } : s));
      } catch {
        setState((s) => (s?.key === key ? { key, status: 'error' } : s));
      }
    })();
  };

  const withPosition = neighbours?.status === 'ok';
  const cells = useMemo(() => {
    const points: Partial<Record<Direction, PointData>> = { center: { sun, earth } };
    if (neighbours?.status === 'ok') {
      for (const [dir, p] of Object.entries(neighbours.points) as [Direction, PointData][]) {
        const h = neighbourHorizons?.[`${dir}_${km}`];
        points[dir] = { sun: withHorizon(p.sun, h), earth: withHorizon(p.earth, h) };
      }
    }
    return evaluate(points, t0, days, scheduleDays * DAY_MS);
  }, [sun, earth, neighbours, neighbourHorizons, km, t0, days, scheduleDays]);
  const summary = summarize(cells);
  const tone = !summary.baselineOk ? 'stop' : summary.failed === 0 ? 'go' : 'caution';
  const rows = DIRECTIONS.filter((d) => cells.some((c) => c.dir === d));

  return (
    <section className="robustness">
      <h3>{t.title}</h3>
      <p className="robustness-help">{t.help}</p>
      <p className={`robustness-verdict robustness-${tone}`} role="status">
        {verdictSentence(summary, withPosition, language)}
      </p>
      <div className="robustness-controls">
        <div role="group" aria-label={t.schedule}>
          <span>{t.schedule}</span>
          {DAY_CHOICES.map((n) => (
            <button key={n} aria-pressed={scheduleDays === n} onClick={() => setScheduleDays(n)}>
              {t.days(n)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t.position}>
          <span>{t.position}</span>
          {KM_CHOICES.map((n) => (
            <button key={n} aria-pressed={km === n} onClick={() => setKm(n)}>
              {t.km(n)}
            </button>
          ))}
        </div>
      </div>
      <div className="robustness-scroll">
        <table aria-label={t.tableLabel}>
          <thead>
            <tr>
              <th scope="col">{t.rowHead}</th>
              {SCHEDULE_STEPS.map((step) => (
                <th key={step} scope="col">
                  {offsetLabel(step * scheduleDays * DAY_MS, language)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((dir) => (
              <tr key={dir}>
                <th scope="row">
                  {t.dir[dir]}
                  {dir === 'center' ? null : <small> {km}km</small>}
                </th>
                {cells
                  .filter((c) => c.dir === dir)
                  .map((c) => (
                    <td
                      key={c.dtMs}
                      className={c.verdict === null ? 'is-skipped' : c.verdict.ok ? 'is-ok' : 'is-fail'}
                      title={cellTitle(c, language)}
                    >
                      {cellText(c, language)}
                      {c.verdict?.ok ? <span className="sr-only">{t.ok}</span> : null}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="robustness-conditions">{t.conditions}</p>
      {withPosition ? null : neighbours?.status === 'loading' ? (
        <p className="robustness-note" role="status">
          {t.loading(neighbours.done)}
        </p>
      ) : (
        <div className="robustness-action">
          {neighbours?.status === 'error' ? <p className="warn">{t.error}</p> : null}
          <button onClick={load}>{neighbours?.status === 'error' ? t.retry : t.evaluatePosition}</button>
          <p className="robustness-note">{t.positionNote}</p>
        </div>
      )}
    </section>
  );
}
