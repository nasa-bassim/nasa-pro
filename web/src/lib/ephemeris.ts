export interface Sample {
  t: string;
  az: number;
  el: number;
  flags?: string;
}

export interface Ephemeris {
  site: string;
  name?: string;
  body: 'sun' | 'earth';
  lat: number;
  lon_e: number;
  source?: string;
  refined?: boolean;
  samples: Sample[];
  // 지형 지평선 고도각(도). 북 0°, 동 90°. 원형 균등 격자(360 또는 3600개). 없으면 매끈한 구.
  horizon?: number[];
}

// 같은 궤도 데이터에 지형 지평선을 붙이거나 뗀 사본.
export function withHorizon(eph: Ephemeris, horizon: number[] | undefined): Ephemeris {
  return { ...eph, horizon };
}

export const BODY_RADIUS_DEG: Record<Ephemeris['body'], number> = {
  sun: 0.27,
  earth: 0.93,
};

// 사전 계산 범위 (PRD 5.1). 파이프라인이 이 구간을 만든다.
export const DATA_RANGE = {
  start: Date.parse('2026-11-01T00:00:00Z'),
  end: Date.parse('2027-05-01T00:00:00Z'),
};

export const DAY_MS = 86400_000;

// PRD 6: t0나 t0+D가 범위를 벗어나면 범위 안 값으로 되돌린다.
// 해석할 수 없는 입력(NaN)도 범위 시작으로 되돌려, 화면에 보이는 t0와
// 계산에 쓰는 t0이 항상 같게 한다.
export function clampT0(t0ms: number, days: number): number {
  const hi = Math.max(DATA_RANGE.start, DATA_RANGE.end - days * DAY_MS);
  if (Number.isNaN(t0ms)) return DATA_RANGE.start;
  return Math.min(Math.max(t0ms, DATA_RANGE.start), hi);
}

// datetime-local 입력값(UTC로 해석)을 epoch ms로.
export function parseT0Input(value: string): number {
  return Date.parse(`${value}:00Z`);
}

// clamp된 t0을 datetime-local 형식 'YYYY-MM-DDTHH:MM'(UTC)으로 되돌린다.
export function formatT0Input(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
