# 📄 피드백 문서 15: 브라우저 기본 alert/confirm 완전 퇴출 및 전역 커스텀 팝업 모달 시스템 구축

- **작성 일시**: 2026-11-03
- **프로젝트**: `2026-MiniGame` (모바일 웹 파티/내기 미니게임 허브)
- **작업 파일**:
  - [`public/index.html`](file:///d:/My%20Web%20App/2026-MiniGame/public/index.html)
  - [`public/js/app.js`](file:///d:/My%20Web%20App/2026-MiniGame/public/js/app.js)

---

## 1. 개선 배경 및 목적

### 문제점
- 브라우저 기본 팝업 창(`alert()`, `confirm()`)을 사용할 경우 상단에 `localhost:3000 내용`과 같은 불필요하고 투박한 시스템 헤더가 강제 노출됩니다.
- 모바일 웹 앱으로서의 앱다운 몰입감(App-like UX)을 심각하게 저해하고, 디자인 일관성이 깨지는 문제가 있었습니다.

### 프로젝트 영구 개발 원칙 수립
> **[원칙] 앞으로 이 프로젝트에서 띄우는 모든 팝업창(단순 알림, 경고, 확인 창 등)은 브라우저 기본 창(`alert()`, `confirm()`)을 일체 사용하지 않고, 반드시 세련된 PC/모바일 반응형 커스텀 팝업 모달(`showAlert`, `showConfirm`)로만 작업합니다.**

---

## 2. 구현 내역

### 1) 범용 커스텀 모달 UI (`public/index.html`)
- 어두운 배경 블러(`backdrop-blur-sm`)와 부드러운 다크모드 카드(`bg-slate-900 border border-slate-700/80 rounded-3xl`) 적용.
- 제목, 동적 아이콘(📢, 🔑, ⚠️, 🚪, 📋), 줄바꿈 안내 메시지, 취소 및 확인 버튼 지원.
- 위험 작업(방 나가기 등) 시 빨간색 강조 버튼(`danger: true`) 지원.

### 2) 비동기 Promise 기반 커스텀 팝업 함수 (`public/js/app.js`)
- `showAlert(message, options = { title, icon, confirmText, danger })`
- `showConfirm(message, options = { title, icon, confirmText, cancelText, danger })`
- 비동기 `async / await` 방식으로 자연스럽게 사용자 응답(확인: `true`, 취소/외부터치/닫기: `false`)을 대기하여 처리.

### 3) 코드베이스 내 기존 alert/confirm 전수 교체 내역

| 기능 위치 | 기존 (브라우저 기본) | 개선 후 (커스텀 팝업) |
|---|---|---|
| 방 코드 미입력 시 | `alert('방 코드 4자리를...')` | `showAlert('...', { title: '입력 확인', icon: '🔑' })` |
| 방 참가 실패 시 | `alert(res.error)` | `showAlert(res.error, { title: '참가 실패', icon: '⚠️' })` |
| 방 생성 실패 시 | `alert(res.error)` | `showAlert(res.error, { title: '생성 실패', icon: '⚠️' })` |
| 게임 시작 실패 시 | `alert(res.error)` | `showAlert(res.error, { title: '시작 실패', icon: '⚠️' })` |
| 방 나가기 확인창 | `confirm(confirmMsg)` | `await showConfirm(confirmMsg, { title: '방 나가기', icon: '🚪', danger: true })` |
| 이빨 조작 오류 시 | `alert(res.error)` | `showAlert(res.error, { title: '조작 오류', icon: '⚠️' })` |
| 카카오톡 결과 복사 | `alert('카톡 공유 결과가...')` | `showAlert('...', { title: '복사 완료', icon: '📋' })` |
| 대기실 복귀 실패 시 | `alert(res.error)` | `showAlert(res.error, { title: '복귀 실패', icon: '⚠️' })` |
| 방 해산 / 방장 퇴장 | `alert('방이 해산되었거나...')` | `showAlert('...', { title: '방 해산 안내', icon: '🚪', danger: true })` |

---

## 3. 검증 결과
- `git grep -n "alert(" public/js/` ➔ **0건 검출 (완전 퇴출 완료)**
- `git grep -n "confirm(" public/js/` ➔ **0건 검출 (완전 퇴출 완료)**
- 13개 단위 테스트 모두 100% 정상 통과 완료.
