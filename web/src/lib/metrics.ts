import { BODY_RADIUS_DEG, DATA_RANGE } from './ephemeris';
import type { Ephemeris, Sample } from './ephemeris';

// 지평선 높이 h(az) (PRD 4.2). 지형 자료가 없으면 매끈한 구(0°),
// 있으면 원형 균등 격자 값을 선형 보간한다.
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

// Between ephemeris samples, interpolate azimuth on its shortest circular arc and
// elevation linearly. Split at EVERY horizon knot: equal endpoint signs can hide
// a ridge crossing. This refines geometry, not the underlying orbital data.
interface Node { t: number; f: number }
const nodeCache = new WeakMap<Ephemeris, Node[]>();
function nodes(eph: Ephemeris): Node[] {
  const cached = nodeCache.get(eph);
  if (cached) return cached;
  const out: Node[] = [];
  for (let i = 0; i < eph.samples.length; i++) {
    const a = eph.samples[i]!;
    const ta = Date.parse(a.t);
    out.push({ t: ta, f: margin(a, eph.body, eph.horizon) });
    const b = eph.samples[i + 1];
    if (!b || !eph.horizon?.length) continue;
    const tb = Date.parse(b.t);
    const da = ((b.az - a.az + 540) % 360) - 180;
    if (!da) continue;
    const step = 360 / eph.horizon.length;
    const lo = Math.min(a.az, a.az + da), hi = Math.max(a.az, a.az + da);
    const fractions: number[] = [];
    for (let k = Math.floor(lo / step) + 1; k * step < hi; k++) {
      fractions.push((k * step - a.az) / da);
    }
    fractions.sort((x, y) => x - y);
    for (const u of fractions) out.push({ t: ta + (tb - ta) * u,
      f: margin({ az: a.az + da * u, el: a.el + (b.el - a.el) * u }, eph.body, eph.horizon) });
  }
  nodeCache.set(eph, out);
  return out;
}

export function crossings(eph: Ephemeris): Crossing[] {
  const ns = nodes(eph), out: Crossing[] = [];
  for (let i = 0; i + 1 < ns.length; i++) {
    const a = ns[i]!, b = ns[i + 1]!;
    if ((a.f < 0) === (b.f < 0)) continue;
    const event = { t: a.t + (b.t - a.t) * a.f / (a.f - b.f), rises: a.f < 0 };
    // Touching zero at one instant has no finite visible/dark interval.
    if (out.at(-1)?.t === event.t) out.pop();
    else out.push(event);
  }
  return out;
}

function visibleAt(eph: Ephemeris, t: number): boolean {
  const ns = nodes(eph);
  let lo = 0, hi = ns.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (ns[mid]!.t <= t) lo = mid; else hi = mid - 1; }
  const a = ns[lo], b = ns[lo + 1];
  if (!a) return false;
  if (!b || t <= a.t) return a.f >= 0;
  return a.f + (b.f - a.f) * (t - a.t) / (b.t - a.t) >= 0;
}

export interface Interval { start: number; end: number }
const intervalCache = new WeakMap<Ephemeris, Interval[]>();
export function visibleIntervals(eph: Ephemeris): Interval[] {
  const cached = intervalCache.get(eph);
  if (cached) return cached;
  const ns = nodes(eph), out: Interval[] = [];
  for (let i = 0; i + 1 < ns.length; i++) {
    const a = ns[i]!, b = ns[i + 1]!;
    if (a.f < 0 && b.f < 0) continue;
    const cross = a.t + (b.t - a.t) * a.f / (a.f - b.f);
    const start = a.f < 0 ? cross : a.t, end = b.f < 0 ? cross : b.t;
    if (end <= start) continue;
    const last = out.at(-1);
    if (last && last.end === start) last.end = end;
    else out.push({ start, end });
  }
  intervalCache.set(eph, out);
  return out;
}
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!, y = b[j]!;
    const start = Math.max(x.start, y.start), end = Math.min(x.end, y.end);
    if (end > start) out.push({ start, end });
    if (x.end <= y.end) i++; else j++;
  }
  return out;
}
export function intervalDuration(intervals: Interval[], start: number, end: number): number {
  return intervals.reduce((sum, r) => sum + Math.max(0, Math.min(end, r.end) - Math.max(start, r.start)), 0);
}

export interface NextEvent {
  // 교차가 있으면 그 방향. 없으면 현재 상태로 기다리는 이벤트 종류를 결정한다.
  kind: 'set' | 'rise';
  t: number | null; // 데이터 범위 끝까지 교차가 없으면 null
  visibleAtT0: boolean;
}

// t0보다 엄격히 뒤에 있는 첫 교차를 반환한다. 정확히 t0인 교차는 제외한다.
// visibleAtT0는 별도로 f(t0) >= 0을 뜻한다. 일몰 경계에서는 true이면서
// 다음 이벤트가 rise일 수 있으므로, 이벤트 종류를 현재 가시성에서 추측하지 않는다.
export function nextEvent(eph: Ephemeris, t0: number): NextEvent {
  const visible = visibleAt(eph, t0);
  for (const c of crossings(eph)) {
    if (c.t <= t0) continue;
    return { kind: c.rises ? 'rise' : 'set', t: c.t, visibleAtT0: visible };
  }
  return { kind: visible ? 'set' : 'rise', t: null, visibleAtT0: visible };
}

export interface WindowStats {
  fraction: number; // 경계 사이의 가시 구간 길이 / 관찰 기간
  sampleCount: number;
  longestDarkHours: number; // sunlit=false 연속 최대 길이 (시간)
  maxElevationAboveHorizon: number | null; // 가시 구간에서 max(el - h), 창 경계의 극한 포함
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
  const end = t0 + days * 86400_000;
  let maxEl: number | null = null;
  const ns = nodes(eph);
  for (let i = 0; i + 1 < ns.length; i++) {
    const a = ns[i]!, b = ns[i + 1]!;
    const left = Math.max(t0, a.t), right = Math.min(end, b.t);
    if (right <= left) continue;
    const at = (t: number) => a.f + (b.f - a.f) * (t - a.t) / (b.t - a.t);
    const fa = at(left), fb = at(right);
    // Positive-length visibility only: an isolated zero is a tangency, while
    // a zero plateau is visible under the existing >= 0 definition.
    if (!(fa > 0 || fb > 0 || (fa === 0 && fb === 0))) continue;
    // f is linear between horizon knots, and f - radius is el - horizon.
    const above = Math.max(fa, fb) - BODY_RADIUS_DEG[eph.body];
    if (maxEl === null || above > maxEl) maxEl = above;
  }
  const intervals = visibleIntervals(eph);
  let cursor = t0, longestMs = 0;
  for (const r of intervals) {
    if (r.end <= t0 || r.start >= end) continue;
    longestMs = Math.max(longestMs, Math.max(t0, r.start) - cursor);
    cursor = Math.min(end, r.end);
  }
  longestMs = Math.max(longestMs, end - cursor);
  return {
    fraction: intervalDuration(intervals, t0, end) / (end - t0),
    sampleCount: samples.length,
    longestDarkHours: longestMs / 3600_000,
    maxElevationAboveHorizon: maxEl,
  };
}

// PRD 4.7: 타임라인 셀. 1시간 1셀.
export interface Timeline {
  intervals: Interval[];
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
  const times: number[] = [];
  for (let t = Math.ceil(t0 / stepMs) * stepMs; t < t0 + days * 86400_000; t += stepMs) times.push(t);
  const sunCells = times.map((t) => visibleAt(sun, t));
  const earthCells = times.map((t) => visibleAt(earth, t));
  return {
    sun: { intervals: visibleIntervals(sun), cells: sunCells, times: times, start: t0, stepMs },
    earth: {
      intervals: visibleIntervals(earth),
      cells: earthCells,
      times: times,
      start: t0,
      stepMs,
    },
    bothVisibleMs: intervalDuration(intersectIntervals(visibleIntervals(sun), visibleIntervals(earth)), t0, t0 + days * 86400_000),
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
