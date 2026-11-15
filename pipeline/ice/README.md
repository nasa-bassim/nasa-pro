# 얼음 탐사 보조 근거 생성

공개 NASA–IBM Ice Prospectivity 체크포인트를 실행하여
`web/public/evidence/ice.json`을 생성한다. PRO 정답 지도는 입력하지 않는다.
브라우저는 정적 파일만 읽으며 기존 Java 서버에 ML 의존성을 추가하지 않는다.

## 실행

저장소 루트에서 Python 3.12와 uv를 사용한다.

```bash
uv venv --python 3.12 pipeline/ice/.venv
uv pip install --python pipeline/ice/.venv/bin/python -r pipeline/ice/requirements.txt
pipeline/ice/.venv/bin/python -u pipeline/ice/generate.py --device cpu
```

모델 약 1.7GB, 입력 지도, 설정은 gitignore된 `pipeline/cache/ice/`에 저장된다.
`--prepare-only`는 지도 다운로드와 좌표 선택만 한다. CPU 실행을 검증했다.
CUDA/MPS는 별도 검증이 필요하다. 같은 캐시에 생성 프로세스를 동시에 실행하지 않는다.
모델·데이터·공식 코드 버전을 고정했다. 기본 모델 가중치는 필요 없지만 구조 설정
`backbone/config.yaml`은 공식 로더가 요구하므로 다운로드한다.

## 계산

- `web/src/sites.ts`의 남위 80~90° 좌표를 읽는다. 현재 6곳, 입력 타일 5개.
- GeoTIFF의 달 좌표계로 변환한다. 지구 EPSG:4326을 사용하지 않는다.
- 같은 위치의 8종 입력(사면 방향 2채널 포함 총 9채널), 256×256 격자를 확인한다.
- 공식 설정의 결측값 0 대체 후 채널별 평균·표준편차 정규화를 적용한다.
- 전체 state_dict를 strict=True로 로딩하고 eval/inference_mode로 실행한다.
- 좌표가 속한 픽셀을 추출한다. 타일 보간이나 가까운 후보지 대체를 하지 않는다.
- 해당 픽셀의 입력이 결측이거나 출력이 비유한/범위 밖이면 no-data로 처리한다.
- 생성물에 모델·데이터·코드 버전, 체크포인트/입력 SHA256, 생성 시각, 장치,
  PyTorch 버전, 타일/픽셀, 데이터 분할, 유효 입력 비율을 기록한다.

제품은 약 240m/픽셀이다. 투영 격자는 238.56m이며 좌표 변환은 실제 affine을 사용한다.
수십 m 단위 착륙 위치 차이를 설명하는 데 사용하지 않는다. 직접 입력 좌표가 사전 계산
좌표와 다르면 "아직 추론하지 않음"으로 표시한다. 날짜별 예측이나 주변 전체 지도는 미지원이다.

## 해석과 검증

물리적 근거를 조합한 전문가 fuzzy-overlay 지도를 모사한 값이다. 얼음 존재 확률,
매장량, 착륙 안전성이 아니다. 전력·통신 순위와 임무 조건 판정은 변경하지 않는다.
공개 벤치마크 입력을 재사용하므로 학습 지역도 포함된다. 실행 성공과 좌표 정합성 검증은
새로운 지역의 일반화 성능이나 실제 얼음 발견 정확도 검증과 다르다.
일부 타일은 가장자리 픽셀 또는 결측 문맥을 포함하므로 근소한 점수 차이를 강조하지 않는다.

`iceEvidence.test.ts`에서 생성물·좌표·점수 범위·누락 상태를 검사한다.
대용량 모델 추론은 선택 작업이며 CI에서 다운로드하거나 반복 실행하지 않는다.

## 출처

- [모델](https://huggingface.co/nasa-ibm-ai4science/Ice-Prospectivity-NASA-IBM-Lunar-Foundation-Model): Apache-2.0
- [공식 코드](https://github.com/NASA-IMPACT/NASA-IBM-Lunar-Foundation-Model): Apache-2.0
- [SomBench 데이터](https://huggingface.co/datasets/nasa-ibm-ai4science/Sombench-Ice-Prospectivity-Regression): CC BY 4.0
  — NASA–IBM AI4Science, Fraccaro et al. (2026), Patil et al. (2026),
  Coyan et al. (2025), *Prospectivity mapping for lunar polar water ice*.
  원자료 제공: LOLA / Diviner / USGS. 생성 JSON은 입력 지도에서 모델로 계산한 파생 결과다.
