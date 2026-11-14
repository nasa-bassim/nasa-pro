import { describe, expect, it } from 'vitest';

import type { Ephemeris } from './ephemeris';
import { crossings, eventMetric, nextEvent, stats, timeline } from './metrics';

// 커밋된 사전 계산 JSON만 읽는다. 네트워크는 쓰지 않는다.
const DATA = import.meta.glob('../../public/data/*.json', { eager: true }) as Record<
  string,
  { default: Ephemeris }
>;
const FIXTURES = import.meta.glob('../../test/fixtures/*.json', { eager: true }) as Record<
  string,
  { default: Ephemeris }
>;

function eph(name: string): Ephemeris {
  const key = `../../public/data/${name}.json`;
  const mod = DATA[key];
  if (!mod) throw new Error(`missing generated file ${key}`);
  return mod.default;
}

function fixture(name: string): Ephemeris {
  const mod = FIXTURES[`../../test/fixtures/${name}.json`];
  if (!mod) throw new Error(`missing fixture ${name}`);
  return mod.default;
}

const T = (iso: string) => Date.parse(iso);
const HOURS = 3600_000;

function sampleAt(e: Ephemeris, iso: string) {
  const s = e.samples.find((x) => x.t === `${iso}Z`);
  if (!s) throw new Error(`no sample at ${iso} in ${e.site}_${e.body}`);
  return s;
}

describe('수용 기준 1: IM-2 지점 태양 표시값', () => {
  const sun = eph('im-2_sun');
  it('2026-11-14 00:00 az 97.597 el 0.871', () => {
    const s = sampleAt(sun, '2026-11-14T00:00:00');
    expect(s.az).toBeCloseTo(97.597, 2);
    expect(s.el).toBeCloseTo(0.871, 2);
  });
  it('2026-11-22 00:00 az 0.181 el 6.756', () => {
    const s = sampleAt(sun, '2026-11-22T00:00:00');
    expect(s.az).toBeCloseTo(0.181, 2);
    expect(s.el).toBeCloseTo(6.756, 2);
  });
});

describe('수용 기준 2: 기준 지점 (-89.9, 0) 2026-11-14 00:00', () => {
  // 이 지점은 큐레이션 8곳에 없어 test/fixtures의 JSON으로만 검증한다.
  it('태양 az 126.620 el 1.497', () => {
    const s = sampleAt(fixture('pole_sun'), '2026-11-14T00:00:00');
    expect(s.az).toBeCloseTo(126.62, 2);
    expect(s.el).toBeCloseTo(1.497, 2);
  });
  it('지구 az 358.773 el -4.548', () => {
    const s = sampleAt(fixture('pole_earth'), '2026-11-14T00:00:00');
    expect(s.az).toBeCloseTo(358.773, 2);
    expect(s.el).toBeCloseTo(-4.548, 2);
  });
});

describe('수용 기준 3: IM-2 t0 2026-11-14 다음 이벤트', () => {
  it('다음 일몰까지 = 2026-12-01 00:44 ± 2시간', () => {
    const m = eventMetric(eph('im-2_sun'), T('2026-11-14T00:00:00Z'), 'sun');
    expect(m.title).toBe('다음 일몰까지');
    expect(m.eventTime).not.toBeNull();
    expect(Math.abs(m.eventTime! - T('2026-12-01T00:44:00Z'))).toBeLessThanOrEqual(2 * HOURS);
  });
  it('다음 Earthset까지 = 2026-12-04 09:29 ± 2시간', () => {
    const m = eventMetric(eph('im-2_earth'), T('2026-11-14T00:00:00Z'), 'earth');
    expect(m.title).toBe('다음 Earthset까지');
    expect(Math.abs(m.eventTime! - T('2026-12-04T09:29:00Z'))).toBeLessThanOrEqual(2 * HOURS);
  });
});

describe('수용 기준 4: IM-2 t0 2026-11-28, D 14일', () => {
  const t0 = T('2026-11-28T00:00:00Z');
  it('일조 비율 22 ± 1%', () => {
    expect(stats(eph('im-2_sun'), t0, 14).fraction).toBeCloseTo(0.22, 2);
    expect(Math.abs(stats(eph('im-2_sun'), t0, 14).fraction - 0.22)).toBeLessThanOrEqual(0.01);
  });
  it('지구 가시 비율 59 ± 1%', () => {
    expect(Math.abs(stats(eph('im-2_earth'), t0, 14).fraction - 0.59)).toBeLessThanOrEqual(0.01);
  });
});

describe('수용 기준 5: IM-2 t0 2026-12-02 (일몰 뒤)', () => {
  it('첫 카드가 다음 일출까지 = 2026-12-12 16:17 ± 2시간', () => {
    const m = eventMetric(eph('im-2_sun'), T('2026-12-02T00:00:00Z'), 'sun');
    expect(m.title).toBe('다음 일출까지');
    expect(Math.abs(m.eventTime! - T('2026-12-12T16:17:00Z'))).toBeLessThanOrEqual(2 * HOURS);
  });
});

describe('수용 기준 6: 기준 지점 t0 2027-03-01, D 28일 — 기간 내 일조 없음', () => {
  it('일조 비율 0', () => {
    const s = stats(fixture('pole_sun'), T('2027-03-01T00:00:00Z'), 28);
    expect(s.fraction).toBe(0);
    expect(s.longestDarkHours).toBe(s.sampleCount);
  });
});

describe('수용 기준 7: Apollo 11, D 28일', () => {
  const t0 = T('2026-11-14T00:00:00Z');
  it('일조 비율 약 50%', () => {
    const f = stats(eph('apollo-11_sun'), t0, 28).fraction;
    expect(f).toBeGreaterThan(0.4);
    expect(f).toBeLessThan(0.6);
  });
  it('지구 가시 비율 100%에 가까움', () => {
    expect(stats(eph('apollo-11_earth'), t0, 28).fraction).toBeGreaterThan(0.95);
  });
});

describe('첫 화면: 기본 시각을 바꾸지 않고 실제 다음 이벤트를 표시한다', () => {
  it('세 번째 열은 아직 일출 직전이며, 직후에는 다음 일몰을 표시한다', () => {
    const sun = eph('im-2_sun');
    const days = (t0: string) => eventMetric(sun, T(`${t0}Z`), 'sun').days!;
    expect(days('2026-11-14T00:00:00')).toBeCloseTo(17.0, 1);
    expect(days('2026-11-28T00:00:00')).toBeCloseTo(3.0, 1);
    const before = eventMetric(sun, T('2026-12-12T16:17:00Z'), 'sun');
    expect(before.title).toBe('다음 일출까지');
    expect(before.days! * 86400).toBeGreaterThan(0);
    expect(before.days! * 86400).toBeLessThan(60);
    const after = eventMetric(sun, T('2026-12-12T16:18:00Z'), 'sun');
    expect(after.title).toBe('다음 일몰까지');
    expect(after.days).toBeCloseTo(17.6, 1);
  });
});

describe('타임라인 (PRD 4.7)', () => {
  it('셀은 1시간 1개, D일이면 24D개', () => {
    const tl = timeline(eph('im-2_sun'), eph('im-2_earth'), T('2026-11-14T00:00:00Z'), 14);
    expect(tl.sun.cells.length).toBe(14 * 24);
    expect(tl.earth.cells.length).toBe(14 * 24);
    // 11-14~12-01 구간은 태양·지구가 모두 뜨는 기간이므로 합이 0보다 크다.
    expect(tl.bothVisibleMs).toBeGreaterThan(0);
  });
  it('정시가 아닌 t0이면 첫 셀은 t0 이후 첫 정시 샘플 시각에 온다', () => {
    // 샘플은 정시 단위라 셀을 t0+i시간에 그리면 축이 어긋난다.
    const tl = timeline(eph('im-2_sun'), eph('im-2_earth'), T('2026-12-12T16:17:00Z'), 14);
    expect(tl.sun.times[0]).toBe(T('2026-12-12T17:00:00Z'));
    expect(tl.earth.times[0]).toBe(T('2026-12-12T17:00:00Z'));
    expect(tl.sun.times.length).toBe(tl.sun.cells.length);
    // 마지막 셀도 실제 샘플 시각이고 창 끝(t0+D) 미만이다.
    const last = tl.sun.times[tl.sun.times.length - 1]!;
    expect(last % HOURS).toBe(0);
    expect(last).toBeLessThan(T('2026-12-12T16:17:00Z') + 14 * 24 * HOURS);
  });
});

describe('지형 지평선', () => {
  const flat = (deg: number) => Array.from({ length: 360 }, () => deg);

  it('horizonHeight는 1° 사이를 선형 보간하고 359°에서 0°로 이어진다', async () => {
    const { horizonHeight } = await import('./metrics');
    const h = Array.from({ length: 360 }, (_, i) => (i === 10 ? 4 : i === 0 ? 2 : 0));
    expect(horizonHeight(123.4)).toBe(0);
    expect(horizonHeight(10, h)).toBe(4);
    expect(horizonHeight(10.5, h)).toBeCloseTo(2);
    expect(horizonHeight(359.5, h)).toBeCloseTo(1);
    expect(horizonHeight(-0.5, h)).toBeCloseTo(1);
  });

  it('지평선이 0°면 매끈한 구와 같고, 높으면 보이는 시간이 줄고, 낮으면 는다', () => {
    const sun = eph('im-2_sun');
    const earth = eph('im-2_earth');
    const t0 = T('2026-11-20T00:00:00Z');
    const base = timeline(sun, earth, t0, 28).bothVisibleMs;
    const at = (deg: number) =>
      timeline({ ...sun, horizon: flat(deg) }, { ...earth, horizon: flat(deg) }, t0, 28).bothVisibleMs;
    expect(at(0)).toBe(base);
    expect(at(3)).toBeLessThan(base);
    expect(at(-3)).toBeGreaterThan(base);
    expect(stats({ ...sun, horizon: flat(3) }, t0, 28).longestDarkHours).toBeGreaterThan(
      stats(sun, t0, 28).longestDarkHours,
    );
  });
});


describe('다음 이벤트 경계 회귀', () => {
  it('IM-2 일몰 24초 전의 이벤트를 건너뛰지 않는다', () => {
    const result = eventMetric(eph('im-2_sun'), T('2026-12-01T00:43:00Z'), 'sun');
    expect(result.title).toBe('다음 일몰까지');
    expect(result.eventTime).toBeCloseTo(T('2026-12-01T00:43:24.190Z'), -1);
  });

  for (const body of ['sun', 'earth'] as const) {
    for (const height of [0, 2]) {
      const radius = body === 'sun' ? 0.27 : 0.93;
      const base = T('2026-11-01T00:00:00Z');
      const data: Ephemeris = {
        site: 'boundary', body, lat: 0, lon_e: 0,
        horizon: height ? Array.from({ length: 360 }, () => height) : undefined,
        samples: [1, -1, 1, -1].map((f, i) => ({
          t: new Date(base + i * HOURS).toISOString(), az: 0, el: height + f - radius,
        })),
      };
      it(`${body}, 지평선 ${height}°: 모든 교차 직전·동일 시각·직후`, () => {
        const events = crossings(data);
        expect(events).toHaveLength(3);
        events.forEach((event, i) => {
          for (const offset of [60_000, 1]) {
            const before = nextEvent(data, event.t - offset);
            expect(before.t).toBe(event.t);
            expect(before.kind).toBe(event.rises ? 'rise' : 'set');
            expect(before.visibleAtT0).toBe(!event.rises);
          }
          for (const offset of [0, 1]) {
            const after = nextEvent(data, event.t + offset);
            expect(after.t).toBe(events[i + 1]?.t ?? null);
            if (events[i + 1]) expect(after.kind).toBe(events[i + 1]!.rises ? 'rise' : 'set');
          }
        });
      });
    }
  }

  it('교차가 없는 기간은 현재 가시성을 유지하고 이벤트 없음을 반환한다', () => {
    const base = eph('apollo-11_earth');
    const result = nextEvent(base, T('2026-11-14T00:00:00Z'));
    expect(result).toEqual({ kind: 'set', t: null, visibleAtT0: true });
  });

  it('정확한 일몰 경계의 가시성은 >= 0 기준을 유지한다', () => {
    const base = T('2026-11-01T00:00:00Z');
    const data: Ephemeris = { site: 'edge', body: 'sun', lat: 0, lon_e: 0,
      samples: [0.73, -1.27, 0.73].map((el, i) => ({
        t: new Date(base + i * HOURS).toISOString(), az: 0, el,
      })),
    };
    expect(nextEvent(data, base + HOURS / 2)).toEqual({
      kind: 'rise', t: base + 1.5 * HOURS, visibleAtT0: true,
    });
  });
});
