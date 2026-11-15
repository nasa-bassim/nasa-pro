import { expect, it } from 'vitest';
import { crossings, stats, timeline, visibleIntervals } from './metrics';
import type { Ephemeris } from './ephemeris';
import { mergeRefinement } from './refinement';
const H = 3600_000, start = Date.parse('2026-11-01T00:00:00Z');
function eph(values: [number, number, number][]): Ephemeris {
  return { site: 'test', body: 'sun', lat: -85, lon_e: 0,
    samples: values.map(([h, az, el]) => ({ t: new Date(start + h * H).toISOString(), az, el: el - .27 })) };
}
it('clips partial boundary hours and integrates unequal observation steps', () => {
  const data = eph([[0, 0, -1], [1, 0, 1], [3, 0, -1]]);
  expect(visibleIntervals(data)).toEqual([{ start: start + .5 * H, end: start + 2 * H }]);
  expect(stats(data, start + .75 * H, 1 / 24).fraction).toBe(1);
  expect(stats(data, start, 3 / 24).longestDarkHours).toBe(1);
  expect(timeline(data, data, start, 3 / 24).bothVisibleMs).toBe(1.5 * H);
});
it('finds a short ridge occultation even when both hourly endpoints are visible', () => {
  const data = eph([[0, 0, 1], [1, 2, 1]]);
  data.horizon = Array(360).fill(0); data.horizon![1] = 2;
  expect(crossings(data).map((c) => (c.t - start) / H)).toEqual([.25, .75]);
  expect(stats(data, start, 1 / 24).fraction).toBe(.5);
  expect(stats(data, start, 1 / 24).longestDarkHours).toBe(.5);
});
it('handles north wrap in either direction without travelling around the globe', () => {
  for (const az of [[359, 1], [1, 359]]) {
    const data = eph([[0, az[0]!, 1], [1, az[1]!, 1]]);
    data.horizon = Array(360).fill(0); data.horizon![0] = 2;
    expect(crossings(data)).toHaveLength(2);
    expect(stats(data, start, 1 / 24).fraction).toBe(.5);
  }
});
it('rejects mismatched, missing, unordered refinements and retains real intermediate observations', () => {
  const base = eph([[0, 0, 1], [1, 0, 1]]);
  const fine = eph([[0, 0, 1], [.5, 0, -1], [1, 0, 1]]);
  expect(stats(mergeRefinement(base, fine), start, 1 / 24).fraction).toBe(.5);
  expect(() => mergeRefinement(base, { ...fine, lat: -86 })).toThrow();
  expect(() => mergeRefinement(base, { ...fine, samples: fine.samples.slice(1) })).toThrow();
  expect(() => mergeRefinement(base, { ...fine, samples: [...fine.samples].reverse() })).toThrow();
});

it('does not report a zero-duration tangency as sunrise and sunset', () => {
  const data = eph([[0,0,-1],[1,0,0],[2,0,-1]]);
  expect(crossings(data)).toEqual([]);
  expect(visibleIntervals(data)).toEqual([]);
});

it('does not label an unchanged hourly series as minute refinement', () => {
  const base = eph([[0,0,1],[1,0,1]]);
  expect(mergeRefinement(base, base).refined).toBe(false);
});

const realRefinements = import.meta.glob('../../public/refined/*.json', { eager: true }) as Record<string, { default: Ephemeris }>;
const originals = import.meta.glob('../../public/data/*.json', { eager: true }) as Record<string, { default: Ephemeris }>;
for (const [path, module] of Object.entries(realRefinements)) {
  it(`validates actual Horizons refinement ${path}`, () => {
    const base = originals[path.replace('/refined/', '/data/')]!.default;
    const data = mergeRefinement(base, module.default);
    expect(data.samples.length).toBeGreaterThanOrEqual(base.samples.length);
    const hasMinute = data.samples.some((s, i) => i > 0
      && Date.parse(s.t) - Date.parse(data.samples[i-1]!.t) === 60_000);
    expect(data.refined).toBe(hasMinute);
    const a = Date.parse(base.samples[0]!.t);
    const days = 14;
    const f = stats(data, a, days);
    expect(f.fraction).toBeGreaterThanOrEqual(0);
    expect(f.fraction).toBeLessThanOrEqual(1);
    expect(f.longestDarkHours).toBeLessThanOrEqual(days * 24);
  });
}

it('calculates maximum elevation at clipped window boundaries without requiring samples inside', () => {
  const rising = eph([[0,0,-1],[1,0,1]]);
  const falling = eph([[0,0,1],[1,0,-1]]);
  expect(stats(rising, start + .75 * H, .15 / 24).maxElevationAboveHorizon).toBeCloseTo(.53);
  expect(stats(falling, start + .1 * H, .15 / 24).maxElevationAboveHorizon).toBeCloseTo(.53);
});
it('includes a visible valley between two invisible terrain samples', () => {
  const data = eph([[0,0,1],[1,2,1]]);
  data.horizon = Array(360).fill(2); data.horizon[1] = 0;
  const result = stats(data, start, 1 / 24);
  expect(result.fraction).toBe(.5);
  expect(result.maxElevationAboveHorizon).toBeCloseTo(.73);
});
it('distinguishes absent daylight, tangency, a zero plateau and a partially visible solar disk', () => {
  expect(stats(eph([[0,0,-1],[1,0,-1]]), start, 1 / 24).maxElevationAboveHorizon).toBeNull();
  expect(stats(eph([[0,0,-1],[1,0,0],[2,0,-1]]), start, 2 / 24).maxElevationAboveHorizon).toBeNull();
  expect(stats(eph([[0,0,0],[1,0,0]]), start, 1 / 24).maxElevationAboveHorizon).toBeCloseTo(-.27);
  expect(stats(eph([[0,0,.1],[1,0,.1]]), start, 1 / 24).maxElevationAboveHorizon).toBeCloseTo(-.17);
});
it('Apollo 11 regression: the final 35 minutes of daylight must not report no sunlight', () => {
  const data = originals['../../public/data/apollo-11_sun.json']!.default;
  const t0 = Date.parse('2026-11-08T01:59:00Z');
  const result = stats(data, t0, 7);
  expect(result.fraction).toBeGreaterThan(0);
  expect(result.maxElevationAboveHorizon).not.toBeNull();
  const a = data.samples.find((s) => s.t === '2026-11-15T01:00:00Z')!;
  const b = data.samples.find((s) => s.t === '2026-11-15T02:00:00Z')!;
  expect(result.maxElevationAboveHorizon).toBeCloseTo(a.el + (b.el - a.el) * 59 / 60, 8);
});
