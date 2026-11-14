# justn-prototype-1

달 착륙지 비교 도구의 연습용 프로토타입입니다. 대회 제출물이 아니며, 이 저장소의 코드와 데이터는 제출물로 옮기지 않습니다.

- `pipeline/`: Python. Horizons 호출과 지형 계산. 8개 큐레이션 지점의 사전 계산
- `backend/`: Java + Spring Boot (Gradle wrapper 포함). 브라우저가 직접 부를 수 없는
  Horizons를 프록시·캐시해서 직접 입력 좌표의 ephemeris를 돌려준다 (`GET /api/ephemeris`)
- `web/`: Vite + React + TypeScript. 생성된 JSON을 읽는 정적 화면
- `schema/`: 두 쪽이 공유하는 JSON 스키마
- `docs/`: 자료 출처와 AI 사용 기록

## 처음 설정

```bash
git config core.hooksPath .githooks
```

push 전에 `scripts/check.sh`가 돕니다. CI도 같은 스크립트를 실행합니다.

CI 테스트는 Horizons를 호출하지 않고 `pipeline/tests/fixtures/`의 저장된 응답만 씁니다.

## 실행

백엔드 (JDK 26 필요, Gradle은 커밋된 wrapper 사용):

```bash
cd backend
./gradlew bootRun        # http://localhost:8080
```

프런트엔드:

```bash
cd web
pnpm install
pnpm dev               # /api 요청은 localhost:8080으로 프록시된다
```

큐레이션 지점 8곳은 `web/public/data/`의 정적 JSON만 쓰므로 백엔드 없이도 동작합니다.
"직접 좌표 입력" 열만 백엔드가 필요합니다. 백엔드가 Horizons에 요청을 보낼 때는 호출
사이에 2초 간격을 두고, 응답은 `backend/cache/`에 캐시됩니다.

## 얼음 탐사 보조 근거

얼음 탐사 보조 근거는 공개 NASA–IBM 모델을 실제 실행해 사전 계산한
`web/public/evidence/ice.json`을 사용합니다. 남극 후보지 6곳을 지원하며,
얼음 존재 확률이나 전력·통신 순위로 사용하지 않습니다.
재생성 방법과 해석 범위는 [추론 파이프라인](pipeline/ice/README.md)을 참고하세요.

## 직접 좌표 API의 과부하 처리

백엔드는 캐시에 없는 서로 다른 요청을 순차 처리합니다. 대기 큐는 기본 16개이며,
큐 대기·호출 간격·Horizons 응답을 합친 기한은 기본 120초입니다.
`backend/src/main/resources/application.properties`의 `ephemeris.queue-capacity`와
`ephemeris.request-timeout`으로 조정할 수 있습니다. 이 값은 초기 운영 기본값이며,
실제 응답 시간과 트래픽에 맞춰 조정해야 합니다.

- 큐 초과: HTTP 503, `Retry-After: 2` (초 단위 재시도 힌트)
- 전체 기한 초과: HTTP 504
- 그 외 Horizons 오류: HTTP 502

오류 본문은 기존과 같은 `{ "error": "..." }` 형식입니다. 자동 재시도는 하지 않습니다.
대기 중 만료된 작업은 upstream을 호출하지 않으며, 동일 좌표·천체의 요청은 하나의 작업을
공유합니다. 캐시 적중은 큐를 거치지 않습니다.
