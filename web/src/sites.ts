// PRD 5.4 큐레이션 지점. 경도는 동쪽 양수.
export interface SiteInfo {
  slug: string;
  name: string;
  lat: number;
  lon_e: number;
  sourceUrl: string;
}

export const SITES: SiteInfo[] = [
  {
    slug: 'im-2',
    name: 'IM-2 의도 착륙지 (Mons Mouton)',
    lat: -84.78,
    lon_e: 29.13,
    sourceUrl: 'https://lroc.im-ldi.com/images/1401',
  },
  {
    slug: 'im-1',
    name: 'IM-1 착륙지 (Malapert A 부근)',
    lat: -80.13,
    lon_e: 1.44,
    sourceUrl: 'https://www.dlr.de/en/blog/archive/2024/german-instrument-to-study-moons-eternal-shadows-with-private-mission',
  },
  {
    slug: 'cr1',
    name: 'Connecting Ridge (CR1)',
    lat: -89.4679,
    lon_e: -137.411,
    sourceUrl: 'https://arxiv.org/abs/1208.5587',
  },
  {
    slug: 'sr1',
    name: 'Shackleton Rim (SR1)',
    lat: -89.7755,
    lon_e: -156.448,
    sourceUrl: 'https://arxiv.org/abs/1208.5587',
  },
  {
    slug: 'mp2',
    name: 'Malapert Peak (MP2)',
    lat: -86.0265,
    lon_e: 2.758,
    sourceUrl: 'https://arxiv.org/abs/1208.5587',
  },
  {
    slug: 'gr2',
    name: 'de Gerlache Rim (GR2)',
    lat: -89.0073,
    lon_e: -94.7636,
    sourceUrl: 'https://arxiv.org/abs/1208.5587',
  },
  {
    slug: 'chandrayaan-3',
    name: 'Chandrayaan-3 Statio Shiv Shakti',
    lat: -69.37,
    lon_e: 32.32,
    sourceUrl: 'https://planetarynames.wr.usgs.gov/Feature/16272',
  },
  {
    slug: 'apollo-11',
    name: 'Apollo 11 LM',
    lat: 0.67416,
    lon_e: 23.47314,
    sourceUrl: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html',
  },
];
