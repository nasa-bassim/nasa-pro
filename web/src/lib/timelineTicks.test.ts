import { describe, expect, it } from 'vitest';

import { DAY_MS } from './ephemeris';
import { tickStepMs } from './timelineTicks';

describe('tickStepMs', () => {
  it('넓은 픽셀 폭에서는 가장 촘촘한 간격을 쓴다', () => {
    // 7일을 4000px에 그리면 1일 간격이 571px로 충분히 넓다.
    expect(tickStepMs(7 * DAY_MS, 4000)).toBe(1 * DAY_MS);
  });

  it('간격이 좁아지면 다음 후보로 올라간다', () => {
    // 14일을 400px에 그리면 1일은 28.6px로 40px 미만, 2일은 57px.
    expect(tickStepMs(14 * DAY_MS, 400)).toBe(2 * DAY_MS);
  });

  it('28일 3열 폭에서도 겹치지 않는 간격을 고른다', () => {
    // 28일을 300px에 그리면 7일은 75px로 충분하다.
    expect(tickStepMs(28 * DAY_MS, 300)).toBe(7 * DAY_MS);
  });

  it('어떤 간격도 좁으면 가장 넓은 간격으로 제한한다', () => {
    expect(tickStepMs(400 * DAY_MS, 100)).toBe(112 * DAY_MS);
  });

  it('선택된 간격은 항상 레이블 최소 간격 조건을 만족하거나 최대 후보다', () => {
    for (const days of [7, 14, 28]) {
      for (const px of [280, 320, 420, 560]) {
        const step = tickStepMs(days * DAY_MS, px);
        const spacingPx = (step / (days * DAY_MS)) * px;
        expect(spacingPx >= 40 || step === 112 * DAY_MS).toBe(true);
      }
    }
  });
});
