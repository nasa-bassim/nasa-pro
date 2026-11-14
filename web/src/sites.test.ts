import { describe, expect, it } from 'vitest';

import type { Ephemeris } from './lib/ephemeris';
import { SITES } from './sites';

// 지점 목록은 파이프라인(파이썬)과 sites.ts(타입스크립트)에 중복으로 있다.
// 생성 JSON의 site/lat/lon_e는 파이썬 쪽 값이므로 둘이 어긋나면 여기서 잡는다.
const DATA = import.meta.glob('../public/data/*_sun.json', { eager: true }) as Record<
  string,
  { default: Ephemeris }
>;

describe('sites.ts와 생성 JSON 일치', () => {
  for (const s of SITES) {
    it(`${s.slug}: slug·lat·lon_e가 같다`, () => {
      const mod = DATA[`../public/data/${s.slug}_sun.json`];
      expect(mod, `${s.slug}_sun.json이 없다`).toBeDefined();
      const json = mod!.default;
      expect(json.site).toBe(s.slug);
      expect(json.lat).toBe(s.lat);
      expect(json.lon_e).toBe(s.lon_e);
    });
  }
});
