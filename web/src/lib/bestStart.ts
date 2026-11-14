import { DATA_RANGE, DAY_MS } from './ephemeris';
import type { Ephemeris } from './ephemeris';
import { isVisible } from './metrics';

export interface BestStart {
  t0: number; // epoch ms. 계산 범위 안에서 가장 유리한 시작 시각
  bothVisibleMs: number; // 그 시각부터 D일 동안 태양과 지구가 함께 보이는 시간
}

const STEP_MS = 3600_000;

// 계산 범위 안의 모든 정시를 시작 시각 후보로 놓고, [t0, t0+D) 동안 태양과 지구가
// 함께 보이는 시간이 가장 긴 시작 시각을 찾는다. 같은 값이면 가장 이른 시각을 고른다.
// timeline()과 같은 방식(1시간 1샘플, 시작 포함·끝 제외)으로 세므로, 찾은 시각을
// 그대로 t0에 넣으면 화면의 값과 일치한다.
export function bestStart(sun: Ephemeris, earth: Ephemeris, days: number): BestStart | null {
  const earthVisible = new Map<number, boolean>();
  for (const s of earth.samples) earthVisible.set(Date.parse(s.t), isVisible(s, 'earth', earth.horizon));

  const times: number[] = [];
  const prefix: number[] = [0]; // prefix[i] = times[0..i) 중 둘 다 보이는 샘플 수
  for (const s of sun.samples) {
    const t = Date.parse(s.t);
    if (t < DATA_RANGE.start || t >= DATA_RANGE.end) continue;
    const both = isVisible(s, 'sun', sun.horizon) && earthVisible.get(t) === true;
    times.push(t);
    prefix.push(prefix[prefix.length - 1]! + (both ? 1 : 0));
  }

  const span = days * DAY_MS;
  let best: BestStart | null = null;
  let end = 0;
  for (let i = 0; i < times.length; i += 1) {
    const t0 = times[i]!;
    if (t0 + span > DATA_RANGE.end) break;
    while (end < times.length && times[end]! < t0 + span) end += 1;
    const ms = (prefix[end]! - prefix[i]!) * STEP_MS;
    if (best === null || ms > best.bothVisibleMs) best = { t0, bothVisibleMs: ms };
  }
  return best;
}
