import { DATA_RANGE, DAY_MS, clampT0, formatT0Input, parseT0Input } from './ephemeris';

// t0 datetime-local 입력의 상태 기계 (순수 함수).
// applied는 마지막으로 적용된 t0의 canonical 문자열('YYYY-MM-DDTHH:MM', UTC, clamp).
// draft는 편집 중인 입력값. null이면 입력은 applied를 표시한다.
// warn은 "계산 범위" 경고 표시 여부. 다음 유효 입력까지 유지된다.
export interface T0Field {
  draft: string | null;
  warn: boolean;
}

export interface T0Decision {
  field: T0Field;
  // 부모(ColumnSpec.t0)에 커밋할 새 applied 값. null이면 커밋 없음.
  apply: string | null;
}

export const T0_MIN = formatT0Input(DATA_RANGE.start);
export const T0_MAX = formatT0Input(DATA_RANGE.end);

export const initialT0Field = (): T0Field => ({ draft: null, warn: false });

// 입력 문자열이 완전한 datetime-local 값이면 epoch ms, 아니면 null.
// '2027-01' 같은 부분 입력이나 빈 문자열은 Date.parse가 NaN이라 null이다.
function parseComplete(raw: string): number | null {
  if (raw === '') return null;
  const ms = parseT0Input(raw);
  return Number.isNaN(ms) ? null : ms;
}

function t0UpperBound(days: number): number {
  return Math.max(DATA_RANGE.start, DATA_RANGE.end - days * DAY_MS);
}

// change 이벤트: 범위 안 완전값만 즉시 적용한다. 범위 밖·불완전·빈 값은
// draft로만 보관해 입력을 리셋하지 않는다 (PRD 6 회귀 수정).
export function t0DraftChange(field: T0Field, raw: string, days: number): T0Decision {
  const ms = parseComplete(raw);
  if (ms !== null && ms >= DATA_RANGE.start && ms <= t0UpperBound(days)) {
    return { field: { draft: null, warn: false }, apply: formatT0Input(ms) };
  }
  return { field: { ...field, draft: raw }, apply: null };
}

// blur/Enter: 범위 밖 draft는 clamp해 커밋하고 경고를 띄운다.
// 빈/해석 불가 draft는 마지막 applied로 되돌리고 커밋하지 않는다.
export function t0Commit(field: T0Field, applied: string, days: number): T0Decision {
  if (field.draft === null) return { field, apply: null };
  const ms = parseComplete(field.draft);
  if (ms === null) return { field: { ...field, draft: null }, apply: null };
  const clamped = clampT0(ms, days);
  const canonical = formatT0Input(clamped);
  return {
    field: { draft: null, warn: clamped !== ms },
    apply: canonical === applied ? null : canonical,
  };
}

// D 변경: t0 + D가 범위 끝을 넘으면 clamp된 t0을 커밋해 열 상태에 남긴다.
// 커밋하지 않으면 D를 되돌릴 때 날짜가 튄다.
export function t0DaysChanged(field: T0Field, applied: string, days: number): T0Decision {
  const ms = parseT0Input(applied);
  const clamped = clampT0(ms, days);
  if (clamped === ms) return { field, apply: null };
  return { field: { draft: null, warn: true }, apply: formatT0Input(clamped) };
}
