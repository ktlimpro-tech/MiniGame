# 💥 07. Socket.io 순환 참조로 인한 서버 크래시(RangeError) 원인 분석 및 완전 해결 보고서

> **작성 일시**: 2026-11-03  
> **프로젝트**: `2026-MiniGame`  
> **관련 파일**: [server/models/Room.js](file:///d:/My%20Web%20App/2026-MiniGame/server/models/Room.js), [server/models/RoomManager.js](file:///d:/My%20Web%20App/2026-MiniGame/server/models/RoomManager.js), [server/server.js](file:///d:/My%20Web%20App/2026-MiniGame/server/server.js)

---

## 1. 발생했던 치명적 에러 로그
```
D:\My Web App\2026-MiniGame\node_modules\socket.io-parser\build\cjs\is-binary.js:32
    if (Array.isArray(obj)) {
              ^
RangeError: Maximum call stack size exceeded
    at Array.isArray (<anonymous>)
    at hasBinary (D:\My Web App\2026-MiniGame\node_modules\socket.io-parser\build\cjs\is-binary.js:32:15)
    at hasBinary (D:\My Web App\2026-MiniGame\node_modules\socket.io-parser\build\cjs\is-binary.js:34:17)
    at hasBinary (D:\My Web App\2026-MiniGame\node_modules\socket.io-parser\build\cjs\is-binary.js:49:63)
    ...
```

---

## 2. 근본 원인 분석 (Root Cause)

1. **클래스 인스턴스 간의 순환 참조 (Circular Reference)**:
   * `Room` 클래스 인스턴스는 게임 엔진 `activeGame`(`CrocodileGame`)을 속성으로 가지고 있습니다:
     `this.activeGame = new CrocodileGame(this);`
   * 반대로 `CrocodileGame` 클래스 인스턴스는 부모 방 `this.room = room;`을 속성으로 가지고 있습니다.
   * 즉, `room ➔ activeGame ➔ room ➔ activeGame ➔ ...` 형태의 **무한 순환 참조 루프**가 메모리 구조상 존재했습니다.

2. **소켓 콜백으로 인스턴스 원본 반환**:
   * `Room.startGame()`과 `RoomManager.startGame()`이 반환한 `result` 객체 안에:
     `{ success: true, room: this }` 처럼 **순환 참조를 가진 `Room` 인스턴스 원본**이 그대로 들어있었습니다.
   * `server.js`에서 방장이 게임을 시작할 때:
     `if (typeof callback === 'function') callback(result);`
     를 실행하는 순간, Socket.io의 파서(`socket.io-parser`)가 바이너리 검사(`hasBinary`)를 위해 객체를 재귀 순회하다가 **순환 루프에 걸려 콜 스택(Call Stack)이 터지며 서버가 즉사(Crash)**한 것입니다.

3. **증상의 발생 메커니즘**:
   * 서버가 `RangeError`로 꺼졌기 때문에, 화면에는 게임 화면이 떴으나 이미 서버 프로세스가 죽어있는 상태였고,
   * 사용자가 이빨을 눌러도 서버가 꺼져 있어서 턴이 넘어가지 않고 먹통이 되었던 것입니다.

---

## 3. 적용된 해결책 (Solution)

### 1) 소켓 반환 데이터에서 순환 참조 원천 차단
* `Room.js`의 모든 반환 메서드(`startGame`, `updateSettings`, `resetToLobby`, `addOrReconnectPlayer`)에서:
  * 인스턴스 원본(`this`) 대신, 순수 데이터만 추출한 **`this.toState()`를 반환하도록 전면 수정**했습니다.
* `RoomManager.js`의 `createRoom`에서도 `room: room.toState()`로 반환하도록 변경했습니다.

### 2) 인코더(Encoder) 무결성 검증
* 실제 크래시를 유발했던 `socket.io-parser`의 `encoder.encode()` 테스트를 수행하여:
  * **기존**: `RangeError: Maximum call stack size exceeded` (크래시)
  * **수정 후**: `ENCODE SUCCESS! Length: 528` (0ms 무결 통과)

---

## 4. 검증 결과
* 단위 테스트 11건 전원 정상 통과 (0 fail).
* 이제 방장이 게임을 시작하고 이빨을 눌러도 서버 프로세스가 절대로 다운되지 않고 안정적으로 유지됩니다.
