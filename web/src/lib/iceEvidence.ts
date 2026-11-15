export const ICE_MODEL = 'nasa-ibm-ai4science/Ice-Prospectivity-NASA-IBM-Lunar-Foundation-Model';
export const ICE_MODEL_URL = `https://huggingface.co/${ICE_MODEL}`;
export const ICE_DATA_URL = 'https://huggingface.co/datasets/nasa-ibm-ai4science/Sombench-Ice-Prospectivity-Regression';

export interface IceSite {
  lat: number;
  lonE: number;
  patch: string;
  status: 'ok' | 'no-data';
  score: number | null;
  datasetSplit: 'train' | 'val' | 'test' | 'unlisted';
}
export interface IceEvidence {
  modelRevision: string;
  datasetRevision: string;
  generatedAt: string;
  resolutionM: number;
  sites: IceSite[];
}

// Reject malformed/stale contracts rather than presenting arbitrary JSON as scientific evidence.
export function parseIceEvidence(value: unknown): IceEvidence {
  if (!value || typeof value !== 'object') throw new Error('Invalid evidence');
  const d = value as Record<string, unknown>;
  if (d.schemaVersion !== 1 || d.model !== ICE_MODEL || d.method !== 'checkpoint-inference'
    || typeof d.modelRevision !== 'string' || !/^[a-f0-9]{40}$/.test(d.modelRevision)
    || typeof d.datasetRevision !== 'string' || !/^[a-f0-9]{40}$/.test(d.datasetRevision)
    || typeof d.generatedAt !== 'string' || !Number.isFinite(Date.parse(d.generatedAt))
    || d.resolutionM !== 240 || !Array.isArray(d.sites)) throw new Error('Invalid evidence');
  const sites = d.sites.map((entry: unknown): IceSite => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid site');
    const s = entry as Record<string, unknown>;
    if (typeof s.lat !== 'number' || !Number.isFinite(s.lat) || s.lat < -90 || s.lat > -80
      || typeof s.lonE !== 'number' || !Number.isFinite(s.lonE) || Math.abs(s.lonE) > 180
      || typeof s.patch !== 'string' || !/^patch_\d{4}_\d{4}_S_80S$/.test(s.patch)
      || !['train', 'val', 'test', 'unlisted'].includes(String(s.datasetSplit))
      || (s.status !== 'ok' && s.status !== 'no-data')
      || (s.status === 'ok' ? typeof s.score !== 'number' || !Number.isFinite(s.score)
        || s.score < 0 || s.score > 1 : s.score !== null)) throw new Error('Invalid site');
    return { lat: s.lat, lonE: s.lonE, patch: s.patch, status: s.status, score: s.score as number | null,
      datasetSplit: s.datasetSplit as IceSite['datasetSplit'] };
  });
  return { modelRevision: d.modelRevision, datasetRevision: d.datasetRevision,
    generatedAt: d.generatedAt, resolutionM: d.resolutionM, sites };
}

export function findIceSite(data: IceEvidence, lat: number, lonE: number): IceSite | undefined {
  // No nearest-site substitution: a neighbouring site can have very different conditions.
  const lon = ((lonE + 180) % 360 + 360) % 360 - 180;
  return data.sites.find((s) => Math.abs(s.lat - lat) < 1e-8
    && Math.abs(((s.lonE - lon + 540) % 360) - 180) < 1e-8);
}
