# 🚀 2026-MiniGame 프로젝트 인수인계서 (Handover Document)

> **안내**: 새 대화창(New Conversation)에서 AI가 이 파일을 읽으면 즉시 100% 컨텍스트를 파악하고 1호 게임 고도화 및 테스트로 이어갈 수 있도록 정리된 핵심 인수인계서입니다.

---

## 1. 프로젝트 정체성 및 탄생 배경
- **프로젝트명**: `2026-MiniGame` (가벼운 모바일 웹 파티/내기 미니게임 허브)
- **위치**: `d:\My Web App\2026-MiniGame`
- **핵심 철학**:
  1. **설명 0초의 직관성**: "누가 커피 살지 30초 만에 공정하고 스릴 있게 결정한다."
  2. **무설치 / 무가입**: 링크/QR 코드 하나로 1초 만에 스마트폰 접속.
  3. **초경량 레고 블록 허브**: 공통 대기실(방 생성/초대/벌칙설정/카톡결과) 뼈대 위에 미니게임을 1개씩 독립 모듈로 탑재.

---

## 2. 이전 프로젝트(2026-PickGame)에서 계승된 '황금 기술 자산'
- **Single Source of Truth**: 모든 판정과 게임 룰, 난수는 서버(`RoomManager`, `games/`)가 쥐고, 클라이언트는 뷰만 렌더링.
- **In-Memory + 자동 소멸 GC**: DB 부하 0원, 대기실 5분 / 결과 10분 / 30분 무조작 시 유령 방 자동 폭파 및 메모리 반환.
- **NTP 정밀 시각 동기화 (`serverTimeOffset`)**: PC와 모바일 간 1밀리초 오차 없는 타이머.
- **카카오톡 단톡방 결과 전송**: 중복 타이틀 제거, 일시 표기, `[이름]: [벌칙]` 단일 포맷 완성.

---

## 3. 현재 구축 상태 (완료된 베이스라인)
1. `server/server.js`: 경량 Express + Socket.io 서버
2. `server/models/RoomManager.js`: 룸 매니저 & GC 수명주기 엔진
3. `server/models/Room.js`: 멀티 미니게임 허브 상태 머신
4. `server/games/crocodile.js`: **1호 게임: 악어 이빨 복불복 룰 엔진** (이빨 누르기, 꽝 트랩 판정, 패배자 확정)
5. `public/index.html`: 글씨 큼직하고 군더더기 없는 모바일 전용 뷰 (Home, Lobby, Game, Result)
6. `public/js/socketManager.js`: 검증된 소켓 통신 & NTP 동기화 클라이언트
7. `public/js/app.js`: 실시간 악어 이빨 인터랙션 & 카톡 공유 스크립트

---

## 4. 새 대화창에서 즉시 착수할 다음 작업 (Next Steps)
1. **서버 구동 및 로컬 테스트 검증**:
   - `npm install` (express, socket.io)
   - `node server/server.js` 실행 및 동작 확인
2. **악어 이빨 인터랙션 시각 효과 강화**:
   - 악어 입 열림/닫힘 SVG 또는 부드러운 CSS 애니메이션 적용
   - 꽝 당첨 시 스마트폰 진동(Vibration API) 및 '콰앙!' 사운드/효과음
3. **깃 저장소 연동 및 Render.com 배포 준비**:
   - 새 깃 저장소 초기화 또는 기존 원격 브랜치 연결
