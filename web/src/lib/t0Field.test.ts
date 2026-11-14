import { describe, expect, it } from 'vitest';

import { DATA_RANGE, formatT0Input } from './ephemeris';
import {
  T0_MAX,
  T0_MIN,
  initialT0Field,
  t0Commit,
  t0DaysChanged,
  t0DraftChange,
} from './t0Field';
import type { T0Field } from './t0Field';

const APPLIED = '2026-11-14T00:00';
const DAYS = 14;

// 입력 컴포넌트 역할: draft가 있으면 draft를, 없으면 applied를 표시한다.
const shown = (field: T0Field, applied: string) => field.draft ?? applied;

describe('t0DraftChange — 편집 중 draft 유지', () => {
  it('범위 안 완전값은 즉시 적용하고 경고를 지운다', () => {
    const d = t0DraftChange({ draft: '2027-04-30T00:00', warn: true }, '2027-01-15T09:00', DAYS);
    expect(d.apply).toBe('2027-01-15T09:00');
    expect(d.field).toEqual({ draft: null, warn: false });
  });

  it('범위 밖 완전값은 draft로만 남고 적용하지 않는다', () => {
    const d = t0DraftChange(initialT0Field(), '2028-01-01T00:00', DAYS);
    expect(d.apply).toBeNull();
    expect(d.field.draft).toBe('2028-01-01T00:00');
  });

  it('불완전한 draft는 적용하지 않는다', () => {
    const d = t0DraftChange(initialT0Field(), '2027-01', DAYS);
    expect(d.apply).toBeNull();
    expect(d.field.draft).toBe('2027-01');
  });

  it('빈 draft는 적용하지 않고 지우지도 않는다', () => {
    const d = t0DraftChange(initialT0Field(), '', DAYS);
    expect(d.apply).toBeNull();
    expect(d.field.draft).toBe('');
  });

  it('연도 자리 입력(2→0→2→7)은 마지막까지 applied를 바꾸지 않는다', () => {
    // Chrome datetime-local에서 연도 세그먼트에 치면 나머지 자리는 유지된 채
    // '0002-…', '0020-…', '0202-…', '2027-…' 순서로 change가 온다.
    let field = initialT0Field();
    const applied = '2026-03-15T00:00';
    const digits = ['0002-03-15T00:00', '0020-03-15T00:00', '0202-03-15T00:00'];
    for (const raw of digits) {
      const d = t0DraftChange(field, raw, DAYS);
      expect(d.apply).toBeNull();
      expect(shown(d.field, applied)).toBe(raw);
      field = d.field;
    }
    const last = t0DraftChange(field, '2027-03-15T00:00', DAYS);
    expect(last.apply).toBe('2027-03-15T00:00');
    expect(last.field.draft).toBeNull();
  });

  it('draft 편집은 기존 경고를 지우지 않는다', () => {
    const d = t0DraftChange({ draft: null, warn: true }, '2030-01-01T00:00', DAYS);
    expect(d.field.warn).toBe(true);
  });
});

describe('t0Commit — blur/Enter', () => {
  it('범위 밖 draft는 clamp해 커밋하고 경고를 띄운다', () => {
    const d = t0Commit({ draft: '2028-06-01T00:00', warn: false }, APPLIED, DAYS);
    // clamp 상한: range end - D = 2027-04-17
    expect(d.apply).toBe(formatT0Input(DATA_RANGE.end - DAYS * 86400_000));
    expect(d.field).toEqual({ draft: null, warn: true });
  });

  it('범위 시작 아래 draft는 범위 시작으로 커밋한다', () => {
    const d = t0Commit({ draft: '0002-11-14T00:00', warn: false }, APPLIED, DAYS);
    expect(d.apply).toBe(T0_MIN);
    expect(d.field.warn).toBe(true);
  });

  it('범위 안 draft는 그대로 커밋하고 경고 없이 끝난다', () => {
    const d = t0Commit({ draft: '2027-03-01T12:00', warn: true }, APPLIED, DAYS);
    expect(d.apply).toBe('2027-03-01T12:00');
    expect(d.field).toEqual({ draft: null, warn: false });
  });

  it('빈 draft는 마지막 applied를 복원하고 커밋하지 않는다', () => {
    const d = t0Commit({ draft: '', warn: false }, APPLIED, DAYS);
    expect(d.apply).toBeNull();
    expect(d.field.draft).toBeNull();
    expect(shown(d.field, APPLIED)).toBe(APPLIED);
  });

  it('해석 불가 draft도 마지막 applied를 복원한다', () => {
    const d = t0Commit({ draft: '2027-01', warn: false }, APPLIED, DAYS);
    expect(d.apply).toBeNull();
    expect(shown(d.field, APPLIED)).toBe(APPLIED);
  });

  it('draft가 없으면 아무 일도 하지 않는다', () => {
    const field = initialT0Field();
    const d = t0Commit(field, APPLIED, DAYS);
    expect(d.field).toBe(field);
    expect(d.apply).toBeNull();
  });
});

describe('t0DaysChanged — D 변경', () => {
  it('t0 + D가 범위 끝을 넘으면 clamp된 t0을 커밋하고 경고를 띄운다', () => {
    const d = t0DaysChanged(initialT0Field(), '2027-04-10T00:00', 28);
    expect(d.apply).toBe(formatT0Input(DATA_RANGE.end - 28 * 86400_000));
    expect(d.field).toEqual({ draft: null, warn: true });
    // D를 되돌려도 applied는 이미 커밋됐으므로 다시 클램프되지 않는다.
    const back = t0DaysChanged(d.field, d.apply!, 14);
    expect(back.apply).toBeNull();
  });

  it('범위 안이면 아무 일도 하지 않는다', () => {
    const field = { draft: null, warn: true };
    const d = t0DaysChanged(field, APPLIED, 28);
    expect(d.apply).toBeNull();
    expect(d.field).toBe(field);
  });

  it('외부 리셋 직후 판정은 경고를 되살리지 않는다', () => {
    // 재현: t0를 범위 끝 근처로 옮겨 경고를 띄우고 D=28로 clamp한 뒤
    // '처음으로'가 applied를 기본값으로 되돌린다. 리셋된 필드로 판정하면
    // 커밋도 경고도 없어야 한다 — 오래된 field(warn:true)를 넘기면 안 된다.
    const clamped = t0DaysChanged(initialT0Field(), '2027-04-25T00:00', 28);
    expect(clamped.field.warn).toBe(true);
    const reset = t0DaysChanged(initialT0Field(), '2026-11-14T00:00', 14);
    expect(reset.apply).toBeNull();
    expect(reset.field).toEqual({ draft: null, warn: false });
  });
});

describe('min/max', () => {
  it('계산 범위와 일치한다', () => {
    expect(T0_MIN).toBe('2026-11-01T00:00');
    expect(T0_MAX).toBe('2027-05-01T00:00');
  });
});
