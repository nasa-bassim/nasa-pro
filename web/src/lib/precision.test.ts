import { expect, it } from 'vitest';
import { crossings, stats } from './metrics';
import type { Ephemeris } from './ephemeris';
const files = import.meta.glob('../../public/refined/*.json', { eager: true }) as Record<string, { default: Ephemeris }>;
const horizons = import.meta.glob('../../public/horizon/*.json', { eager: true }) as Record<string, { default: { points: { center: number[] } } }>;
for (const [path, mod] of Object.entries(files)) {
  it(`compares actual 5-minute and 1-minute boundary estimates: ${path}`, () => {
    const h = horizons[`../../public/horizon/${mod.default.site}.json`]?.default.points.center;
    const fine = { ...mod.default, horizon: h };
    const coarse = { ...fine, samples: fine.samples.filter((s) => Date.parse(s.t) % 300_000 === 0) };
    const a = crossings(coarse), b = crossings(fine);
    const shifts = b.map((event) => {
      const matches = a.filter((other) => other.rises === event.rises && Math.abs(other.t-event.t) < 3600_000);
      return matches.length ? Math.min(...matches.map((other) => Math.abs(other.t-event.t))) / 1000 : null;
    });
    expect(b.every((event) => Number.isFinite(event.t))).toBe(true);
    const t0 = Date.parse('2026-11-28T00:00:00Z');
    console.info(mod.default.site, mod.default.body, {
      events5m: a.length, events1m: b.length,
      unmatched: shifts.filter((s) => s === null).length,
      maxShiftSeconds: Math.max(0, ...shifts.filter((s): s is number => s !== null)),
      darkHours5m: stats(coarse, t0, 14).longestDarkHours,
      darkHours1m: stats(fine, t0, 14).longestDarkHours,
    });
  });
}
