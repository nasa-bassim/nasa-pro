import { describe, expect, it } from 'vitest';
import generated from '../../public/evidence/ice.json';
import { SITES } from '../sites';
import { findIceSite, ICE_MODEL, parseIceEvidence } from './iceEvidence';

const fixture = () => ({ schemaVersion: 1, model: ICE_MODEL, method: 'checkpoint-inference',
  modelRevision: 'a'.repeat(40), datasetRevision: 'b'.repeat(40),
  generatedAt: '2026-11-15T00:00:00Z', resolutionM: 240,
  sites: [{ lat: -84.78, lonE: 29.13, patch: 'patch_0001_0002_S_80S', status: 'ok', score: 0.42, datasetSplit: 'train' }] });

describe('ice supporting evidence', () => {
  it('ships inference records at exactly the six supported curated coordinates', () => {
    const data = parseIceEvidence(generated);
    const supported = SITES.filter((s) => s.lat >= -90 && s.lat <= -80);
    expect(data.sites).toHaveLength(supported.length);
    for (const site of supported) {
      expect(findIceSite(data, site.lat, site.lon_e)?.status).toBe('ok');
    }
  });
  it('binds scores to coordinates, never to the nearest site', () => {
    const data = parseIceEvidence(fixture());
    expect(findIceSite(data, -84.78, 29.13)?.score).toBe(0.42);
    expect(findIceSite(data, -84.7801, 29.13)).toBeUndefined();
    expect(findIceSite(data, 0, 29.13)).toBeUndefined();
    expect(findIceSite(data, -84.78, 389.13)?.score).toBe(0.42);
  });
  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid scores %s', (score) => {
    const input = fixture(); input.sites[0]!.score = score;
    expect(() => parseIceEvidence(input)).toThrow();
  });
  it('rejects labels presented as inference and malformed data', () => {
    expect(() => parseIceEvidence({ ...fixture(), method: 'ground-truth' })).toThrow();
    expect(() => parseIceEvidence({ ...fixture(), sites: [null] })).toThrow();
    expect(() => parseIceEvidence({ ...fixture(), model: 'other' })).toThrow();
  });
  it('keeps missing evidence distinct from a zero score', () => {
    const input = fixture(); input.sites[0]!.score = 0;
    expect(parseIceEvidence(input).sites[0]!.score).toBe(0);
    expect(parseIceEvidence({ ...input, sites: [{ ...input.sites[0], status: 'no-data', score: null }] })
      .sites[0]!.score).toBeNull();
  });
});
