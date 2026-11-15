import type { Ephemeris } from './ephemeris';
export function mergeRefinement(base: Ephemeris, value: unknown): Ephemeris {
  if (!value || typeof value !== 'object') throw new Error('Invalid refinement');
  const d = value as Ephemeris;
  if (d.site !== base.site || d.body !== base.body || d.lat !== base.lat || d.lon_e !== base.lon_e
    || !Array.isArray(d.samples) || d.samples.length < base.samples.length) throw new Error('Wrong refinement');
  let previous = -Infinity;
  const times = new Set<string>();
  for (const s of d.samples) {
    const t = Date.parse(s.t);
    if (!Number.isFinite(t) || t <= previous || !Number.isFinite(s.az) || s.az < 0 || s.az > 360
      || !Number.isFinite(s.el) || Math.abs(s.el) > 90) throw new Error('Invalid samples');
    previous = t; times.add(s.t);
  }
  if (base.samples.some((s) => !times.has(s.t)) || d.samples[0]!.t !== base.samples[0]!.t
    || d.samples.at(-1)!.t !== base.samples.at(-1)!.t) throw new Error('Incomplete refinement');
  const hasMinuteSamples = d.samples.some((s, i) => i > 0
    && Date.parse(s.t) - Date.parse(d.samples[i - 1]!.t) === 60_000);
  return { ...base, samples: d.samples, refined: hasMinuteSamples };
}
export async function fetchRefinement(base: Ephemeris): Promise<Ephemeris> {
  try {
    const r = await fetch(`/refined/${base.site}_${base.body}.json`);
    if (!r.ok) return base;
    return mergeRefinement(base, await r.json());
  } catch { return base; }
}
