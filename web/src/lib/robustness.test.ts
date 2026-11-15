import { describe, expect, it } from 'vitest';

import { bestStart } from './bestStart';
import { DATA_RANGE, DAY_MS } from './ephemeris';
import type { Ephemeris } from './ephemeris';
import { timeline } from './metrics';
import { MOON_RADIUS_KM, evaluate, judge, offsetCoord, summarize } from './robustness';

const DATA = import.meta.glob('../../public/data/*.json', { eager: true }) as Record<
  string,
  { default: Ephemeris }
>;
const eph = (name: string): Ephemeris => DATA[`../../public/data/${name}.json`]!.default;

const HOUR = 3600_000;

// el이 주어진 시간대에만 양수인 가짜 궤도. 시작은 계산 범위의 처음.
function fake(body: 'sun' | 'earth', hours: number, visible: (h: number) => boolean): Ephemeris {
  const samples = Array.from({ length: hours }, (_, h) => ({
    t: new Date(DATA_RANGE.start + h * HOUR).toISOString(),
    az: 0,
    el: visible(h) ? 10 : -10,
  }));
  return { site: 'fake', body, lat: 0, lon_e: 0, samples };
}

describe('bestStart', () => {
  it('둘 다 보이는 구간이 시작되는 시각을 고른다', () => {
    const best = bestStart(fake('sun', 240, (h) => h >= 100 && h < 160), fake('earth', 240, (h) => h >= 110), 1)!;
    expect(best.t0).toBe(DATA_RANGE.start + 110 * HOUR);
    expect(best.bothVisibleMs).toBe(24 * HOUR);
  });

  it('같은 값이면 가장 이른 시각을 고른다', () => {
    const best = bestStart(fake('sun', 240, () => true), fake('earth', 240, () => true), 2)!;
    expect(best.t0).toBe(DATA_RANGE.start);
  });

  it('찾은 시각을 t0에 넣으면 화면의 값과 같고, 다른 어떤 정시보다 짧지 않다', () => {
    for (const site of ['im-2', 'sr1', 'apollo-11']) {
      const sun = eph(`${site}_sun`);
      const earth = eph(`${site}_earth`);
      for (const days of [7, 14, 28]) {
        const best = bestStart(sun, earth, days)!;
        expect(best.t0 + days * DAY_MS).toBeLessThanOrEqual(DATA_RANGE.end);
        expect(timeline(sun, earth, best.t0, days).bothVisibleMs).toBe(best.bothVisibleMs);
        for (let t = DATA_RANGE.start; t + days * DAY_MS <= DATA_RANGE.end; t += 37 * HOUR) {
          expect(timeline(sun, earth, t, days).bothVisibleMs).toBeLessThanOrEqual(best.bothVisibleMs);
        }
      }
    }
  });

  it('기간이 계산 범위보다 길면 후보가 없다', () => {
    expect(bestStart(eph('im-2_sun'), eph('im-2_earth'), 400)).toBeNull();
  });
});

describe('offsetCoord', () => {
  it('북쪽으로 가면 위도만 km/R 라디안만큼 는다', () => {
    const p = offsetCoord(-84.78, 29.13, 0, 10);
    expect(p.lat).toBeCloseTo(-84.78 + (10 / MOON_RADIUS_KM) * (180 / Math.PI), 6);
    expect(p.lonE).toBeCloseTo(29.13, 6);
  });

  it('적도에서 동쪽으로 가면 경도만 는다', () => {
    const p = offsetCoord(0, 0, 90, 30);
    expect(p.lat).toBeCloseTo(0, 6);
    expect(p.lonE).toBeCloseTo((30 / MOON_RADIUS_KM) * (180 / Math.PI), 6);
  });

  it('극 근처에서도 실제 이동 거리가 요청한 거리와 같다', () => {
    const from = { lat: -89.7755, lonE: -156.448 };
    for (const bearing of [0, 90, 180, 270]) {
      const to = offsetCoord(from.lat, from.lonE, bearing, 10);
      const r = Math.PI / 180;
      const cos =
        Math.sin(from.lat * r) * Math.sin(to.lat * r) +
        Math.cos(from.lat * r) * Math.cos(to.lat * r) * Math.cos((to.lonE - from.lonE) * r);
      expect(Math.acos(Math.min(1, cos)) * MOON_RADIUS_KM).toBeCloseTo(10, 3);
      expect(to.lonE).toBeGreaterThanOrEqual(-180);
      expect(to.lonE).toBeLessThan(180);
    }
  });
});

describe('judge / evaluate / summarize', () => {
  const always = { sun: fake('sun', 24 * 40, () => true), earth: fake('earth', 24 * 40, () => true) };
  // 10일째부터 30시간 동안 해가 진다
  const dip = { sun: fake('sun', 24 * 40, (h) => h < 240 || h >= 270), earth: always.earth };
  const t0 = DATA_RANGE.start + 5 * DAY_MS;

  it('암흑 허용치를 넘으면 dark, 동시 가시가 절반에 못 미치면 overlap', () => {
    expect(judge(always.sun, always.earth, t0, 3)).toMatchObject({ ok: true, reasons: [] });
    expect(judge(dip.sun, dip.earth, t0, 7)).toMatchObject({ ok: false, reasons: ['dark'] });
    expect(judge(dip.sun, dip.earth, t0, 7).darkHours).toBeCloseTo(29.973, 6);
    const never = fake('earth', 24 * 40, () => false);
    expect(judge(always.sun, never, t0, 3).reasons).toEqual(['overlap']);
  });

  it('모든 조합이 통과하면 실패가 0이다', () => {
    const cells = evaluate({ center: always, north: always, south: always }, t0, 3, DAY_MS);
    expect(cells).toHaveLength(15);
    expect(summarize(cells)).toMatchObject({ evaluated: 15, failed: 0, baselineOk: true, failDirs: [] });
  });

  it('남쪽 점만 어두우면 남쪽을, 늦을 때만 어두우면 late를 짚는다', () => {
    // 3일 창: 예정 시각(5일째 시작)에는 암흑 전에 끝나고, 늦어지면 암흑에 걸린다
    const south = summarize(evaluate({ center: always, south: { sun: fake('sun', 24 * 40, (h) => h < 130 || h >= 160), earth: always.earth } }, t0, 3, DAY_MS));
    expect(south.baselineOk).toBe(true);
    expect(south.failDirs).toEqual(['south']);
    expect(south.late).toBe(false);

    const late = summarize(evaluate({ center: dip }, DATA_RANGE.start + 6 * DAY_MS, 3, 3 * DAY_MS));
    expect(late).toMatchObject({ baselineOk: true, late: true, early: false, reasons: ['dark'] });
  });

  it('계산 범위를 벗어난 시작 시각은 평가에서 뺀다', () => {
    const cells = evaluate({ center: always }, DATA_RANGE.start, 3, DAY_MS);
    expect(cells.filter((c) => c.verdict === null)).toHaveLength(2);
    expect(summarize(cells).evaluated).toBe(3);
  });
});
