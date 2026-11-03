# 📄 피드백 문서 19: Render.com 클라우드 배포 준비, 20개 방 상한선, 해킹/공격 원천 차단 및 보안 환경변수 체계 구축

- **작성 일시**: 2026-11-03
- **프로젝트**: `2026-MiniGame` (모바일 웹 파티/내기 미니게임 허브)
- **작업 파일**:
  - [`server/config.js`](file:///d:/My%20Web%20App/2026-MiniGame/server/config.js) (신규)
  - [`.env.example`](file:///d:/My%20Web%20App/2026-MiniGame/.env.example) (신규)
  - [`server/models/RoomManager.js`](file:///d:/My%20Web%20App/2026-MiniGame/server/models/RoomManager.js)
  - [`server/server.js`](file:///d:/My%20Web%20App/2026-MiniGame/server/server.js)
  - [`package.json`](file:///d:/My%20Web%20App/2026-MiniGame/package.json)
  - [`test/room.test.js`](file:///d:/My%20Web%20App/2026-MiniGame/test/room.test.js)

---

## 1. 구현 내역 요약

사용자께서 요청하신 사항과 이전 프로젝트(`2026-PickGame`)의 모범 설정을 바탕으로, GitHub 및 Render.com 배포를 위한 완벽한 보안/인프라 체계를 구축했습니다.

### ① 모임방 개설 개수 20개 절대 상한선 (하드 리밋) & GC 회수 보장
- **동작**:
  - 서버 전체 활성 방 개수가 20개에 도달하면, 21번째 방 개설 시도 시 즉시 친절한 안내와 함께 생성을 차단합니다:
    `"현재 서버의 최대 활성 방(20개)이 가득 찼습니다. 잠시 후 다른 방이 종료되면 다시 시도해주세요."`
- **인메모리 GC 소멸 보장**:
  - 유휴 방(대기실 5분, 결과화면 10분, 0명 이탈 1분)이 GC에 의해 삭제(`destroyRoom`)되면, `this.rooms.delete()`뿐 아니라 `this.socketToRoom` 맵핑까지 즉시 완벽 소멸되어 카운트가 실시간 감소(예: 20개 ➔ 19개)합니다.
  - 회수된 자리에 새로운 방이 즉시 개설될 수 있음을 단위 테스트로 100% 검증했습니다.

### ② 외부 해킹 및 무차별 공격 원천 차단 (보안 강화)
1. **무제한 방 만들기 공격 차단 (Rate Limiting)**:
   - 동일 비-화이트리스트 IP에서 1분당 최대 2개까지만 방 생성을 허용합니다. (초과 시 1분간 차단)
2. **방 코드 무차별 대입(Brute-force) 공격 차단**:
   - 존재하지 않는 방 코드를 연속 5회 이상 틀릴 경우, 해당 IP는 1분간 `joinRoom` 접근이 차단됩니다.
3. **Render.com 리버스 프록시 IP 감지**:
   - `app.set('trust proxy', 1)` 및 `x-forwarded-for` 첫 번째 IP 추출을 적용하여, 클라우드 로드밸런서 뒤에서도 실제 접속자 IP를 정확히 식별합니다.

### ③ 중앙 집중식 설정 관리 (`server/config.js`) & GitHub 보안 분리
- **보안 환경변수 로더**:
  - `dotenv` 패키지 없이도 로컬 `.env` 파일을 자동 파싱하여 주입.
  - `.gitignore`에 `.env`가 등록되어 있으므로, GitHub에 Push하더라도 **관리자 비밀번호와 IP 화이트리스트가 절대 외부에 유출되지 않습니다.**
- **GitHub 공개용 템플릿**:
  - [`.env.example`](file:///d:/My%20Web%20App/2026-MiniGame/.env.example)을 추가하여 배포 시 필요한 환경변수 목록을 표준화했습니다.

### ④ 관리자 모니터링 API 2중 보안 검증 (`/api/admin/stats`)
- **검증 절차**:
  1. 접속자의 IP가 `ADMIN_WHITELIST_IPS`에 포함되어 있는지 검사.
  2. 요청 헤더(`x-admin-password`) 또는 쿼리(`?password=`)가 `ADMIN_PASSWORD`와 일치하는지 검사.
  3. 두 조건 중 하나도 만족하지 못하면 `403 Forbidden`으로 즉시 차단.

---

## 2. Render.com 배포 전 사전 점검 및 체크리스트 보고

| 점검 항목 | 현재 상태 | 상세 설명 및 권장 조치 |
|---|---|---|
| **Render Start Command** | 준비 완료 (`npm start`) | `package.json`의 `"start": "node server/server.js"`로 프로덕션 최적화 완료. |
| **무중단 헬스체크 URL** | 준비 완료 (`/health`) | Render.com 대시보드의 **Health Check Path**에 `/health`를 지정하면, 배포 시 제로 다운타임 검증 및 무중단 서빙이 가능합니다. |
| **Render 무료 티어 슬립 대응** | 점검 필요 | Render 무료 인스턴스는 15분간 요청이 없으면 슬립(Spin-down) 모드로 들어갑니다. 최초 접속 시 30초~50초 깨어나는 지연이 있을 수 있으므로, UptimeRobot 같은 무료 핑 서비스를 연동하여 주기적으로 `/health`를 호출하는 것을 추천합니다. |
| **WebSocket 연결 호환성** | 준비 완료 | Socket.io의 `transports: ['websocket', 'polling']`이 활성화되어 있어 Render의 프록시 네트워크에서 끊김 없이 동작합니다. |
| **Node.js 버전 일치** | 준비 완료 | Node v18+ ~ v24 지원 (현재 로컬 v24.12.0). |

---

## 3. Render.com 대시보드 등록용 환경변수 가이드

Render.com에서 Web Service를 생성할 때 **Environment Variables** 탭에 다음을 등록하시면 됩니다:

```env
NODE_ENV=production
MAX_ROOMS=20
ADMIN_IPS=127.0.0.1,::1,사용자공인IP
ADMIN_PASSWORD=원하는_관리자_비밀번호_입력
```

---

## 4. 단위 테스트 검증 결과

- `node --test test/**/*.test.js`
- **테스트 결과**: **19개 단위 테스트 100% 통과 (171ms)**
  - 악어 게임 7개 테스트 통과
  - 룸 라이프사이클 8개 테스트 통과
  - **방 20개 하드 리밋, GC 소멸 후 회수, IP 생성 제한, 브루트포스 차단 4개 테스트 신규 통과**
