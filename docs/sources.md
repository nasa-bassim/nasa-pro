# 자료 출처

| 자료 | 용도 | 조건 |
|---|---|---|
| [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) | 태양·지구 방위각과 고도각 | 응답의 NASA/JPL Horizons 표기 유지 |
| Horizons OBSERVER 테이블 사전 계산 (`web/public/data/*.json`, `web/test/fixtures/*.json`) | 8개 큐레이션 지점 + 기준 지점(-89.9, 0)의 태양·지구 az/el, 2026-11-01~2027-05-01, 1시간 간격 | `pipeline/generate.py`로 생성, 호출 간격 2초, `pipeline/cache/`에 원본 캐시. 각 JSON의 `source` 필드에 응답 signature 기록 |
| `backend/`의 실시간 Horizons 프록시 (`GET /api/ephemeris?lat=&lon_e=&body=`) | 직접 입력 좌표의 태양·지구 az/el, 사전 계산과 같은 범위·간격(2026-11-01~2027-05-01, 1시간) | 단일 순차 큐, 호출 간격 2초, `backend/cache/`에 원본 캐시(gitignore), 오류 응답은 캐시하지 않음 |
| PRD 지점 목록 출처: [LROC](https://lroc.im-ldi.com/images/1401), [DLR](https://www.dlr.de/en/blog/archive/2024/german-instrument-to-study-moons-eternal-shadows-with-private-mission), [De Rosa et al. 2012](https://arxiv.org/abs/1208.5587), [IAU Gazetteer](https://planetarynames.wr.usgs.gov/Feature/16272), [NSSDC](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html) | `web/src/sites.ts` 좌표와 출처 링크 | PRD §5.4 표 그대로 |
| [LRO WAC South Pole Mosaic](https://commons.wikimedia.org/wiki/File:LRO_WAC_South_Pole_Mosaic.jpg) (NASA/GSFC/Arizona State University) | 3D 달의 80°S 이남 표면 (`web/public/img/lunar-south-pole.jpg`, 1920px) | 퍼블릭 도메인. 극평사도법, 가장자리 80°S, 위쪽이 경도 0°. 화면 각주에 출처 표기, 내려받은 기록은 `web/public/img/credits.json` |
| [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) `lroc_color_poles_2k.tif` (LROC WAC 색 지도) | 3D 달의 표면 색 (`web/public/img/moon-surface.jpg`, 2048×1024 JPG로 변환) | 퍼블릭 도메인. 등장방형, 가운데가 경도 0° |
| [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) `ldem_16_uint.tif` (LOLA 고도, 1/16°) | 3D 달의 분화구 음영 (`web/public/img/moon-relief.jpg`: R은 동쪽 경사, G는 북쪽 경사, B는 고도. 2048×1024) | 퍼블릭 도메인. 원본(33MB)은 저장소에 넣지 않고 경사만 계산해 넣음. 화면에서는 경사를 4배 과장해 그림 |
| [NASA LRO LOLA GDR](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/) `ldem_75s_240m.img` (남위 75° 이남 고도, 극 평사도법 240m 격자) | 남극 후보지 6곳과 그 주변 5·10·20km 점의 지형 지평선 고도각 (`web/public/horizon/*.json`: 방위각 1° 간격 360개 값) | 퍼블릭 도메인(NASA PDS). 원본(29MB)은 저장소에 넣지 않고 `pipeline/cache/lola/`에 받아 `pipeline/terrain.py`로 계산. 관측 높이 지표 위 2m, 250km까지 탐색. Chandrayaan-3와 Apollo 11은 자료 범위 밖이라 지형 미반영 |

# AI 사용 기록

얼음 탐사 근거: [NASA–IBM Ice Prospectivity 모델](https://huggingface.co/nasa-ibm-ai4science/Ice-Prospectivity-NASA-IBM-Lunar-Foundation-Model)
(Apache-2.0)과 [SomBench 극지 데이터](https://huggingface.co/datasets/nasa-ibm-ai4science/Sombench-Ice-Prospectivity-Regression)
(CC BY 4.0, NASA–IBM AI4Science / Fraccaro et al. 2026 / Patil et al. 2026 /
Coyan et al. 2025; 원자료 LOLA, Diviner, USGS)를 사용했다.
`pipeline/ice/generate.py`가 실제 추론한 파생 결과를 `web/public/evidence/ice.json`에 저장한다.
전문가 유망도 지도의 모사 결과이며 얼음 관측·매장량·착륙 안전성으로 해석하지 않는다.
버전과 입력 해시는 생성물, 재현 절차는 `pipeline/ice/README.md`에 기록한다.

| 날짜 | 도구 | 사용 내용 |
|---|---|---|
| 2026-11-01 | Claude Code | 저장소 구조, Horizons 파서, CI 작성 |
| 2026-11-01 | Devin (SWE-2 Medium, brgr 워커) | 1단계 P0 전체: 생성 CLI와 18개 JSON 생성, 지표 로직+vitest(수용 기준 1~7), 비교 화면, 스키마 갱신, check.sh |
| 2026-11-01 | Devin (SWE-2 Medium, brgr 워커) | Spring Boot Horizons 프록시(backend/)와 파서 이식+테스트, 웹 직접 좌표 입력 열, Vite 프록시, CI/check.sh/문서 갱신 |
| 2026-11-14 | Claude Code | 비교 화면 디자인 개편(어두운 바탕, 낮·밤 띠 강조), 돌려 볼 수 있는 3D 달과 지점 표시 추가(WebGL, 고도 자료에서 경사 지도 계산) |
| 2026-11-14 | Claude Code | 가장 유리한 시작 시각 찾기, 위치·일정 오차 견고성 평가(주변 4개 지점 × 일정 5개 시각을 같은 임무 조건으로 재평가) 추가 |
| 2026-11-14 | Claude Code | LOLA 고도 자료로 지형 지평선 계산(pipeline/terrain.py)과 웹 가시성 계산 반영, 지형 가림 반영 스위치 추가 |

## 정밀 가시성 계산 추가 자료

- NASA PGDA [High-Resolution LOLA Topography](https://pgda.gsfc.nasa.gov/products/78),
  `Site04_final_adj_5mpp_surf.tif` (Barker et al. 2021): Shackleton Rim 중심의 5m 지역 고도.
  기존 LOLA 240m 광역 자료와 결합해 250km, 방위 0.1° 지평선을 생성했다.
  5m는 격자 간격이며 실제 측정 정확도가 아니다. 주변 오차 평가 점은 기존 자료를 유지한다.
- `web/public/refined/`: 원본과 동일한 지점/기간의 실제 Horizons 5분·1분 선택 구간 관측.
  경험적 ±0.25° 선별 여유와 이웃 구간 확장을 사용한다. 이는 정밀도 보증이 아니다.
