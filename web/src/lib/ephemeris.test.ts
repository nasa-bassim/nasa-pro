import { describe, expect, it } from 'vitest';

import { DATA_RANGE, DAY_MS, clampT0, formatT0Input, parseT0Input } from './ephemeris';

const T = (iso: string) => Date.parse(iso);

describe('clampT0 (PRD 6: 범위 밖은 범위 안 값으로 되돌린다)', () => {
  it('범위 안 t0은 그대로 둔다', () => {
    const t0 = T('2026-12-12T16:17:00Z');
    expect(clampT0(t0, 14)).toBe(t0);
  });

  it('범위 시작보다 이르면 범위 시작으로 되돌린다', () => {
    expect(clampT0(T('2026-01-01T00:00:00Z'), 14)).toBe(DATA_RANGE.start);
    expect(clampT0(T('2020-06-01T00:00:00Z'), 14)).toBe(DATA_RANGE.start);
  });

  it('t0+D가 범위 끝을 넘으면 t0 = end - D로 되돌린다', () => {
    // 2028-01-01 입력 버그: 지표는 clamp된 시각으로 계산되므로 표시도 같은 시각이어야 한다.
    expect(clampT0(T('2028-01-01T00:00:00Z'), 14)).toBe(DATA_RANGE.end - 14 * DAY_MS);
    // 범위 안 t0이라도 D를 키워 t0+D가 끝을 넘으면 같은 규칙.
    expect(clampT0(T('2027-04-25T00:00:00Z'), 14)).toBe(DATA_RANGE.end - 14 * DAY_MS);
    expect(clampT0(T('2027-04-17T00:00:00Z'), 14)).toBe(T('2027-04-17T00:00:00Z'));
  });

  it('해석할 수 없는 입력(NaN)은 범위 시작으로 되돌린다', () => {
    expect(clampT0(Number.NaN, 14)).toBe(DATA_RANGE.start);
    expect(clampT0(parseT0Input(''), 14)).toBe(DATA_RANGE.start);
    expect(clampT0(parseT0Input('not-a-date'), 14)).toBe(DATA_RANGE.start);
  });
});

describe('formatT0Input/parseT0Input', () => {
  it('clamp 결과를 입력창 형식으로 되돌리면 라운드트립된다', () => {
    const clamped = clampT0(T('2028-01-01T00:00:00Z'), 14);
    expect(formatT0Input(clamped)).toBe('2027-04-17T00:00');
    expect(parseT0Input(formatT0Input(clamped))).toBe(clamped);
  });
});
