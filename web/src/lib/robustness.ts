import { DATA_RANGE, DAY_MS } from './ephemeris';
import type { Ephemeris } from './ephemeris';
import { stats, timeline } from './metrics';

// 초기 선별에 쓰는 임무 조건. 열의 "이 후보지 판단"과 오차 평가가 같은 기준을 쓴다.
export const MISSION = {
  minOverlapPercent: 50, // 태양·지구 동시 가시가 관찰 기간의 이 비율 이상
  maxDarkHours: 24, // 연속 암흑 허용치
};

export type FailReason = 'dark' | 'overlap';

export interface Verdict {
  ok: boolean;
  overlapPercent: number;
  darkHours: number;
  reasons: FailReason[];
}

export function judge(sun: Ephemeris, earth: Ephemeris, t0: number, days: number): Verdict {
  const overlapPercent = Math.round((timeline(sun, earth, t0, days).bothVisibleMs / (days * DAY_MS)) * 100);
  const darkHours = stats(sun, t0, days).longestDarkHours;
  const reasons: FailReason[] = [];
  if (darkHours > MISSION.maxDarkHours) reasons.push('dark');
  if (overlapPercent < MISSION.minOverlapPercent) reasons.push('overlap');
  return { ok: reasons.length === 0, overlapPercent, darkHours, reasons };
}

export const MOON_RADIUS_KM = 1737.4;
const DEG = Math.PI / 180;

// 구면 위에서 (lat, lonE)로부터 방위각 bearing(북 0°, 동 90°) 방향으로 km만큼 간 점.
// 극 근처에서는 경도 차이를 단순 나눗셈으로 구할 수 없어 대권 공식을 쓴다.
export function offsetCoord(lat: number, lonE: number, bearingDeg: number, km: number): { lat: number; lonE: number } {
  const d = km / MOON_RADIUS_KM;
  const p1 = lat * DEG;
  const b = bearingDeg * DEG;
  const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b);
  const p2 = Math.asin(Math.min(1, Math.max(-1, sinP2)));
  const dl = Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sinP2);
  const lon = ((((lonE + dl / DEG + 180) % 360) + 360) % 360) - 180;
  return { lat: p2 / DEG, lonE: lon };
}

export const DIRECTIONS = ['center', 'north', 'south', 'east', 'west'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const BEARING: Record<Exclude<Direction, 'center'>, number> = { north: 0, east: 90, south: 180, west: 270 };

// 일정 오차 ±E를 다섯 점(−E, −E/2, 0, +E/2, +E)으로 평가한다.
export const SCHEDULE_STEPS = [-1, -0.5, 0, 0.5, 1] as const;

export interface PointData {
  sun: Ephemeris;
  earth: Ephemeris;
}

export interface Cell {
  dir: Direction;
  dtMs: number;
  verdict: Verdict | null; // 계산 범위를 벗어난 시작 시각은 평가하지 않는다
}

export function evaluate(
  points: Partial<Record<Direction, PointData>>,
  t0: number,
  days: number,
  scheduleMs: number,
): Cell[] {
  const cells: Cell[] = [];
  for (const dir of DIRECTIONS) {
    const p = points[dir];
    if (!p) continue;
    for (const step of SCHEDULE_STEPS) {
      const dtMs = step * scheduleMs;
      const start = t0 + dtMs;
      const inRange = start >= DATA_RANGE.start && start + days * DAY_MS <= DATA_RANGE.end;
      cells.push({ dir, dtMs, verdict: inRange ? judge(p.sun, p.earth, start, days) : null });
    }
  }
  return cells;
}

export interface Summary {
  evaluated: number;
  failed: number;
  baselineOk: boolean; // 기준점·예정 시각
  failDirs: Exclude<Direction, 'center'>[]; // 예정 시각 그대로, 위치만 벗어나도 실패하는 방향
  late: boolean; // 기준점 그대로, 일정만 늦어져도 실패
  early: boolean; // 기준점 그대로, 일정만 당겨져도 실패
  reasons: FailReason[]; // 실패한 조합에서 나온 사유
}

export function summarize(cells: Cell[]): Summary {
  const done = cells.filter((c) => c.verdict !== null);
  const fails = done.filter((c) => !c.verdict!.ok);
  const failDirs = [...new Set(fails.filter((c) => c.dtMs === 0 && c.dir !== 'center').map((c) => c.dir))];
  const reasons = (['dark', 'overlap'] as const).filter((r) => fails.some((c) => c.verdict!.reasons.includes(r)));
  return {
    evaluated: done.length,
    failed: fails.length,
    baselineOk: !fails.some((c) => c.dir === 'center' && c.dtMs === 0),
    failDirs: failDirs as Exclude<Direction, 'center'>[],
    late: fails.some((c) => c.dir === 'center' && c.dtMs > 0),
    early: fails.some((c) => c.dir === 'center' && c.dtMs < 0),
    reasons,
  };
}
