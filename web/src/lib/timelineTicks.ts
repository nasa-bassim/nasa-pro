import { DAY_MS } from './ephemeris';

// 타임라인 눈금 간격 선택 (순수 함수).
// 눈금 레이블은 'MM-DD' 5글자라 실제 렌더링 기준 약 33px를 차지한다.
// 겹치지 않으려면 눈금 간격이 렌더링 px 기준 minSpacingPx 이상이어야 한다.
// spanMs를 plotWidthPx px에 그릴 때 그 조건을 만족하는 가장 촘촘한
// 일 단위 간격을 고른다. 어떤 간격도 좁으면 가장 넓은 간격을 쓴다.
const STEP_DAYS = [1, 2, 3, 7, 14, 28, 56, 112];

export function tickStepMs(spanMs: number, plotWidthPx: number, minSpacingPx = 40): number {
  for (const d of STEP_DAYS) {
    if (((d * DAY_MS) / spanMs) * plotWidthPx >= minSpacingPx) return d * DAY_MS;
  }
  return STEP_DAYS[STEP_DAYS.length - 1]! * DAY_MS;
}
