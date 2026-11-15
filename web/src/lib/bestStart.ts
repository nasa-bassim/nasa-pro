import { DATA_RANGE, DAY_MS } from './ephemeris';
import type { Ephemeris } from './ephemeris';
import { intersectIntervals, intervalDuration, visibleIntervals } from './metrics';

export interface BestStart {
  t0: number; // epoch ms. 계산 범위 안에서 가장 유리한 시작 시각
  bothVisibleMs: number; // 그 시각부터 D일 동안 태양과 지구가 함께 보이는 시간
}

const STEP_MS = 3600_000;

// 계산 범위 안의 모든 정시를 시작 시각 후보로 놓고, [t0, t0+D) 동안 태양과 지구가
// 함께 보이는 시간이 가장 긴 시작 시각을 찾는다. 같은 값이면 가장 이른 시각을 고른다.
// 시간 후보는 정시를 유지하되, 각 후보의 점수는 가시 구간 길이로 계산한다.
export function bestStart(sun: Ephemeris, earth: Ephemeris, days: number): BestStart | null {
  if (days <= 0 || !sun.samples.length || !earth.samples.length) return null;
  const intervals = intersectIntervals(visibleIntervals(sun), visibleIntervals(earth));
  const first = Math.max(DATA_RANGE.start, Date.parse(sun.samples[0]!.t), Date.parse(earth.samples[0]!.t));
  const last = Math.min(DATA_RANGE.end, Date.parse(sun.samples.at(-1)!.t), Date.parse(earth.samples.at(-1)!.t));
  const span = days * DAY_MS;
  let best: BestStart | null = null;
  for (let t0 = Math.ceil(first / STEP_MS) * STEP_MS; t0 + span <= last; t0 += STEP_MS) {
    const ms = intervalDuration(intervals, t0, t0 + span);
    if (best === null || ms > best.bothVisibleMs) best = { t0, bothVisibleMs: ms };
  }
  return best;
}
