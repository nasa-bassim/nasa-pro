// PRD 5.4 큐레이션 지점. 경도는 동쪽 양수.
export interface SiteInfo {
  slug: string;
  nameKo: string;
  nameEn: string;
  lat: number;
  lon_e: number;
  sourceUrl: string;
}

export const SITES: SiteInfo[] = [
  {
    slug: 'im-2',
    nameKo: 'IM-2 예정 착륙지 (몽 무통)',
    nameEn: 'IM-2 intended landing site (Mons Mouton)',
    lat: -84.78,
    lon_e: 29.13,
    sourceUrl: 'https://lroc.im-ldi.com/images/1401',
  },
  {
    slug: 'im-1',
    nameKo: 'IM-1 착륙지 (말라페르 A 부근)',
    nameEn: 'IM-1 landing site (near Malapert A)',
    lat: -80.13,
    lon_e: 1.44,
    sourceUrl: 'https://www.dlr.de/en/blog/archive/2024/german-instrument-to-study-moons-eternal-shadows-with-private-mission',
  },
  {
    slug: 'cr1',
    nameKo: '커넥팅 리지 (CR1)',
    nameEn: 'Connecting Ridge (CR1)',
    lat: -89.4679,
    lon_e: -137.411,
    sourceUrl: 'https://arxiv.org/abs/1208.5587',
  },
  {
    slug: 'sr1',
    nameKo: '섀클턴 림 (SR1)',
    nameEn: 'Shackleton Rim (SR1)',
    lat: -89.7755,
    lon_e: -156.448,
    sourceUrl: 'https://arxiv.org/abs/1208.5587',
  },
  {
    slug: 'mp2',
    nameKo: '말라페르 봉우리 (MP2)',
    nameEn: 'Malapert Peak (MP2)',
    lat: -86.0265,
    lon_e: 2.758,
    sourceUrl: 'https://arxiv.org/abs/1208.5587',
  },
  {
    slug: 'gr2',
    nameKo: '드 제를라슈 림 (GR2)',
    nameEn: 'de Gerlache Rim (GR2)',
    lat: -89.0073,
    lon_e: -94.7636,
    sourceUrl: 'https://arxiv.org/abs/1208.5587',
  },
  {
    slug: 'chandrayaan-3',
    nameKo: '찬드라얀 3호 시브 샥티 지점',
    nameEn: 'Chandrayaan-3 Statio Shiv Shakti',
    lat: -69.37,
    lon_e: 32.32,
    sourceUrl: 'https://planetarynames.wr.usgs.gov/Feature/16272',
  },
  {
    slug: 'apollo-11',
    nameKo: '아폴로 11호 달 착륙선',
    nameEn: 'Apollo 11 LM',
    lat: 0.67416,
    lon_e: 23.47314,
    sourceUrl: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html',
  },
];

// 좁은 자리(시나리오 칩, 달 위 이름표)에 쓰는 짧은 이름.
const SHORT_NAME: Record<string, string> = {
  'chandrayaan-3': 'Chandrayaan-3',
  'apollo-11': 'Apollo 11',
};
const SHORT_NAME_KO: Record<string, string> = {
  'chandrayaan-3': '찬드라얀 3호',
  'apollo-11': '아폴로 11호',
};

export const localizedSiteName = (site: SiteInfo, language: 'ko' | 'en'): string =>
  language === 'ko' ? site.nameKo : site.nameEn;

export const shortSiteName = (slug: string, language: 'ko' | 'en'): string =>
  (language === 'ko' ? SHORT_NAME_KO[slug] : SHORT_NAME[slug]) ?? slug.toUpperCase();
