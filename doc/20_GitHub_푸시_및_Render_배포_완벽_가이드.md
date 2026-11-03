# 📄 피드백 문서 20: GitHub 푸시 및 Render.com 클라우드 배포 완벽 가이드

- **작성 일시**: 2026-11-03
- **프로젝트**: `2026-MiniGame` (모바일 웹 파티/내기 미니게임 허브)
- **목적**: 로컬에서 개발 및 검증이 완료된 프로젝트를 GitHub에 안전하게 푸시하고, Render.com을 통해 24시간 실시간 접속 가능한 모바일 웹 서비스로 무료 배포하는 단계별 가이드

---

## 1. [1단계] GitHub 저장소 생성 및 코드 푸시 절차

### 1-1. GitHub에서 새 저장소(New Repository) 만들기
1. [GitHub (github.com)](https://github.com)에 로그인합니다.
2. 우측 상단의 `+` 버튼 클릭 ➔ **[New repository]** 선택.
3. 저장소 설정:
   - **Repository name**: `2026-MiniGame` (또는 원하는 이름)
   - **Public / Private**: 자유 선택 (민감 정보는 `.env`로 격리되어 있어 Public도 안전합니다)
   - ⚠️ **주의**: `Add a README file`, `.gitignore`, `License` 체크박스는 **모두 체크 해제(체크하지 않음)** 상태로 둡니다. (이미 로컬에 커밋이 완료되어 있기 때문)
4. 하단의 **[Create repository]** 초록색 버튼 클릭.

### 1-2. 로컬 터미널에서 GitHub 연결 및 푸시
프로젝트 루트 폴더(`d:\My Web App\2026-MiniGame`) 터미널에서 다음 명령어를 순서대로 실행합니다:

```bash
# 1. GitHub 원격 저장소 주소 등록 (본인의 GitHub 계정명으로 변경)
git remote add origin https://github.com/본인GitHub계정/2026-MiniGame.git

# 2. 로컬의 master 브랜치를 GitHub에 푸시
git push -u origin master
```

> **[팁] 브랜치 이름을 `main`으로 바꾸고 싶다면?**
> ```bash
> git branch -M main
> git push -u origin main
> ```

---

## 2. [2단계] Render.com 클라우드 배포 절차 (무료 호스팅)

Render.com은 Node.js 및 WebSocket(Socket.io)을 완벽 지원하며, 무료 SSL 인증서(https)를 기본 제공하여 모바일 진동(Vibration API)과 사운드가 완벽하게 동작합니다.

### 2-1. Render 가입 및 대시보드 이동
1. [Render.com (render.com)](https://render.com)에 접속하여 로그인합니다. (GitHub 계정으로 연동 로그인 추천)
2. 대시보드 우측 상단의 **[New +]** 버튼 클릭 ➔ **[Web Service]** 선택.

### 2-2. GitHub 저장소 연동 (Connect)
1. `Connect a repository` 목록에서 방금 푸시한 **`2026-MiniGame`**을 찾아서 **[Connect]** 버튼을 누릅니다.
   *(목록에 안 보이면 `Configure GitHub App`을 눌러 저장소 접근 권한을 허용해 줍니다)*

### 2-3. 웹 서비스 기본 설정 입력
아래 표와 똑같이 입력합니다:

| 항목 | 입력값 | 설명 |
|---|---|---|
| **Name** | `2026-minigame` | 서비스 접속 URL이 됩니다 (`https://2026-minigame.onrender.com`) |
| **Region** | **Singapore (Southeast Asia)** | 🌟 한국에서 가장 가까운 리전으로 핑/레이턴시가 가장 빠릅니다. |
| **Branch** | `master` (또는 `main`) | 푸시한 브랜치 선택 |
| **Root Directory** | *(비워둠)* | 프로젝트 루트를 그대로 사용 |
| **Runtime** | `Node` | Node.js 런타임 |
| **Build Command** | `npm install` | 의존성 설치 |
| **Start Command** | `npm start` | 서버 구동 명령어 (`node server/server.js`) |
| **Instance Type** | **Free** | 무료 플랜 선택 |

### 2-4. 환경변수(Environment Variables) 등록
화면 아래쪽의 **[Environment Variables]** 섹션에서 **Add Environment Variable**을 눌러 다음 키-값을 추가합니다:

1. `NODE_ENV`: `production`
2. `MAX_ROOMS`: `20`
3. `ADMIN_IPS`: `127.0.0.1,::1` *(관리자 접속 허용 IP, 쉼표 구분)*
4. `ADMIN_PASSWORD`: `본인이_정할_관리자_비밀번호`

### 2-5. 고급 설정(Advanced) - 헬스체크 등록
1. 맨 아래 **[Advanced]** 버튼을 클릭하여 펼칩니다.
2. **Health Check Path** 항목에 **`/health`**를 입력합니다.
   *(Render가 배포 시 `/health`를 호출하여 정상 구동을 확인한 후 안전하게 트래픽을 넘깁니다)*

### 2-6. 배포 시작 (Deploy)
1. 맨 아래의 **[Deploy Web Service]** 버튼 클릭!
2. 약 1~2분 정도 빌드 및 배포 로그가 흐른 후, 상단에 **`Live`** 초록색 뱃지가 뜨면 배포 완료입니다!
3. 상단에 표시되는 URL (예: `https://2026-minigame.onrender.com`)을 복사하여 스마트폰 브라우저나 PC에서 바로 접속해 즐기실 수 있습니다.

---

## 3. [꿀팁] Render 무료 티어 15분 슬립(Sleep) 방지법

Render.com의 무료 플랜은 **15분 동안 아무런 접속이 없으면 서버가 절전(Spin-down) 모드**로 들어갑니다.
이 상태에서 누군가 처음 접속하면 서버가 깨어나는 데 약 30~50초 정도 딜레이가 발생합니다.

### 24시간 깨어있게 만드는 1분 설정 (UptimeRobot 무료 서비스)
1. [UptimeRobot (uptimerobot.com)](https://uptimerobot.com)에 무료 가입합니다.
2. **[Add New Monitor]** 클릭:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `MiniGame Hub Health`
   - **URL (or IP)**: `https://2026-minigame.onrender.com/health`
   - **Monitoring Interval**: `5 minutes` (5분마다)
3. **[Create Monitor]** 완료!
4. 이제 5분마다 UptimeRobot이 가벼운 `/health` 엔드포인트를 찔러주므로, **서버가 절대 잠들지 않고 24시간 언제 접속해도 1초 만에 즉시 열립니다.**
