import { BODY_RADIUS_DEG, DATA_RANGE } from './ephemeris';
import type { Ephemeris, Sample } from './ephemeris';

// 지평선 높이 h(az) (PRD 4.2). 지형 자료가 없으면 매끈한 구(0°),
// 있으면 1° 간격 값을 선형 보간한다.
export function horizonHeight(azDeg: number, horizon?: number[]): number {
  if (!horizon || horizon.length === 0) return 0;
  const n = horizon.length;
  const x = ((((azDeg / 360) * n) % n) + n) % n;
  const i = Math.floor(x);
  const f = x - i;
  return horizon[i]! * (1 - f) + horizon[(i + 1) % n]! * f;
}

// PRD 4.3: visible(t) := el(t) + ρ >= h(az(t))
export function margin(
  sample: Pick<Sample, 'az' | 'el'>,
  body: Ephemeris['body'],
  horizon?: number[],
): number {
  return sample.el + BODY_RADIUS_DEG[body] - horizonHeight(sample.az, horizon);
}

export function isVisible(
  sample: Pick<Sample, 'az' | 'el'>,
  body: Ephemeris['body'],
  horizon?: number[],
): boolean {
  return margin(sample, body, horizon) >= 0;
}

export interface Crossing {
  t: number; // epoch ms
  rises: boolean; // true: 안 보임 -> 보임
}

// PRD 4.4: 부호가 바뀌는 연속 두 샘플 사이를 선형 보간한다.
export function crossings(eph: Ephemeris): Crossing[] {
  const out: Crossing[] = [];
  const s = eph.samples;
  for (let i = 0; i + 1 < s.length; i += 1) {
    const a = s[i]!;
    const b = s[i + 1]!;
    const fa = margin(a, eph.body, eph.horizon);
    const fb = margin(b, eph.body, eph.horizon);
    if (fa < 0 === fb < 0) continue;
    const ta = Date.parse(a.t);
    const tb = Date.parse(b.t);
    out.push({ t: ta + ((tb - ta) * fa) / (fa - fb), rises: fa < 0 });
  }
  return out;
}

// t0 시점 상태를 알기 위해 t0 직전까지의 샘플·교차를 본다.
function visibleAt(eph: Ephemeris, t0: number): boolean {
  const s = eph.samples;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const t = Date.parse(s[i]!.t);
    if (t <= t0) {
      // t0가 샘플과 샘플 사이에 있으면 선형 보간한 f(t0)의 부호로 판정한다.
      const next = s[i + 1];
      if (t === t0 || next === undefined) return isVisible(s[i]!, eph.body, eph.horizon);
      const fa = margin(s[i]!, eph.body, eph.horizon);
      const fb = margin(next, eph.body, eph.horizon);
      const tb = Date.parse(next.t);
      const f = fa + ((fb - fa) * (t0 - t)) / (tb - t);
      return f >= 0;
    }
  }
  return isVisible(s[0]!, eph.body, eph.horizon);
}

export interface NextEvent {
  // t0에 보이면 'set', 안 보이면 'rise'
  kind: 'set' | 'rise';
  t: number | null; // 데이터 범위 끝까지 교차가 없으면 null
  visibleAtT0: boolean;
}

// t0가 교차 시각에 걸쳐 있을 때(예: 일출 직후 수십 초) 교차를 이미 일어난 것으로 본다.
// Horizons가 발표하는 이벤트 시각은 분 단위 반올림이라 t0가 실제 교차보다 조금 앞설 수 있다.
const COINCIDENCE_MS = 60_000;

// PRD 4.5: t0 이후 첫 번째 상태 전환까지.
export function nextEvent(eph: Ephemeris, t0: number): NextEvent {
  let visible = visibleAt(eph, t0);
  for (const c of crossings(eph)) {
    if (c.t <= t0) continue;
    if (c.t - t0 <= COINCIDENCE_MS) {
      visible = c.rises;
      continue;
    }
    return { kind: visible ? 'set' : 'rise', t: c.t, visibleAtT0: visible };
  }
  return { kind: visible ? 'set' : 'rise', t: null, visibleAtT0: visible };
}

export interface WindowStats {
  fraction: number; // 보이는 샘플 비율
  sampleCount: number;
  longestDarkHours: number; // sunlit=false 연속 최대 길이 (시간)
  maxElevationAboveHorizon: number | null; // 보이는 샘플 중 max(el - h)
}

function windowSamples(eph: Ephemeris, t0: number, days: number): Sample[] {
  const end = t0 + days * 86400_000;
  return eph.samples.filter((s) => {
    const t = Date.parse(s.t);
    return t >= t0 && t < end;
  });
}

export function stats(eph: Ephemeris, t0: number, days: number): WindowStats {
  const samples = windowSamples(eph, t0, days);
  let visibleCount = 0;
  let darkRun = 0;
  let longestDark = 0;
  let maxEl: number | null = null;
  for (const s of samples) {
    if (isVisible(s, eph.body, eph.horizon)) {
      visibleCount += 1;
      darkRun = 0;
      const above = s.el - horizonHeight(s.az, eph.horizon);
      if (maxEl === null || above > maxEl) maxEl = above;
    } else {
      darkRun += 1;
      if (darkRun > longestDark) longestDark = darkRun;
    }
  }
  return {
    fraction: samples.length === 0 ? 0 : visibleCount / samples.length,
    sampleCount: samples.length,
    longestDarkHours: longestDark, // 1시간 샘플
    maxElevationAboveHorizon: maxEl,
  };
}

// PRD 4.7: 타임라인 셀. 1시간 1셀.
export interface Timeline {
  cells: boolean[]; // 시간 순서
  times: number[]; // 각 셀의 실제 샘플 시각 (epoch ms)
  start: number;
  stepMs: number;
}

export function timeline(
  sun: Ephemeris,
  earth: Ephemeris,
  t0: number,
  days: number,
): { sun: Timeline; earth: Timeline; bothVisibleMs: number } {
  const stepMs = 3600_000;
  // 샘플은 정시 단위라 t0이 정시가 아니면 첫 셀은 t0이 아니라
  // t0 이후 첫 정시에 온다. 그릴 때는 times를 써야 축이 어긋나지 않는다.
  const sunSamples = windowSamples(sun, t0, days);
  const earthSamples = windowSamples(earth, t0, days);
  const sunCells = sunSamples.map((s) => isVisible(s, 'sun', sun.horizon));
  const earthCells = earthSamples.map((s) => isVisible(s, 'earth', earth.horizon));
  let both = 0;
  for (let i = 0; i < Math.min(sunCells.length, earthCells.length); i += 1) {
    if (sunCells[i] && earthCells[i]) both += 1;
  }
  return {
    sun: { cells: sunCells, times: sunSamples.map((s) => Date.parse(s.t)), start: t0, stepMs },
    earth: {
      cells: earthCells,
      times: earthSamples.map((s) => Date.parse(s.t)),
      start: t0,
      stepMs,
    },
    bothVisibleMs: both * stepMs,
  };
}

export interface MetricResult {
  title: string;
  // 표시용: 기간(일) 또는 없음 문구. 절대 시각은 eventTime에 따로 둔다.
  days: number | null;
  eventTime: number | null;
  text: string | null; // '범위 내 없음', '일조 없음' 등
}

const DAY_MS = 86400_000;

export function eventMetric(
  eph: Ephemeris,
  t0: number,
  kind: 'sun' | 'earth',
): MetricResult {
  const ev = nextEvent(eph, t0);
  const names =
    kind === 'sun'
      ? { set: '다음 일몰까지', rise: '다음 일출까지' }
      : { set: '다음 Earthset까지', rise: '다음 Earthrise까지' };
  const title = names[ev.kind];
  if (ev.t === null) {
    const remaining = (DATA_RANGE.end - t0) / DAY_MS;
    return { title, days: null, eventTime: null, text: `범위 내 없음 (≥ ${Math.floor(remaining)}일)` };
  }
  return { title, days: (ev.t - t0) / DAY_MS, eventTime: ev.t, text: null };
}
