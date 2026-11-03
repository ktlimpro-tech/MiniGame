class CrocodileGame {
  constructor(room) {
    this.room = room;
    this.teethCount = 12; // 악어 이빨 12개
    this.trapIndex = -1;  // 꽝 이빨 인덱스
    this.pressedTeeth = []; // 이미 누른 이빨 인덱스 목록
    this.turnPlayerIndex = 0; // 현재 턴 플레이어 인덱스
    this.loserPlayer = null; // 물린 패배자

    // 1. 5초 시한폭탄 타이머 설정
    this.turnTimeoutSec = 5; // 턴당 5초
    this.turnExpiresAt = null;
    this.turnTimer = null;
    this.onTimeoutCallback = null;
  }

  init() {
    const playerCount = this.room.players.length;
    // 모바일 한 화면(스크롤 없음)에 쏙 들어오도록 10~16개 캡 적용
    if (playerCount <= 3) {
      this.teethCount = 10; // 2~3인: 10개 (4x3 그리드)
    } else if (playerCount <= 5) {
      this.teethCount = 12; // 4~5인: 12개 (4x3 그리드)
    } else {
      this.teethCount = 16; // 6인 이상 최대: 16개 (4x4 그리드)
    }

    this.trapIndex = Math.floor(Math.random() * this.teethCount);
    this.pressedTeeth = [];
    // 첫 번째 턴을 랜덤으로 추첨하여 매 판 공평한 기회 부여
    this.turnPlayerIndex = Math.floor(Math.random() * playerCount);
    this.loserPlayer = null;
    this.clearTurnTimer();
    console.log(`[Crocodile] Initialized with ${this.teethCount} teeth (players: ${playerCount}). Trap: ${this.trapIndex}, First turn: ${this.getCurrentPlayer()?.nickname}`);
  }

  getCurrentPlayer() {
    return this.room.players[this.turnPlayerIndex];
  }

  // 3. 후반부 악어 분노 단계 (0: 평온, 1: 경계/흥분, 2: 극도분노/폭주)
  getRageLevel() {
    const remaining = this.teethCount - this.pressedTeeth.length;
    if (remaining <= 3) return 2; // 남은 이빨 3개 이하: 극도 분노 폭주!
    if (remaining <= 6) return 1; // 남은 이빨 6개 이하: 경계 & 흥분
    return 0; // 평온
  }

  // 5초 타이머 시작 (서버)
  startTurnTimer(onTimeout) {
    this.clearTurnTimer();
    this.onTimeoutCallback = onTimeout;
    this.turnExpiresAt = Date.now() + this.turnTimeoutSec * 1000;

    // 네트워크 레이턴시 0.3초 감안하여 5.3초 뒤 발동
    this.turnTimer = setTimeout(() => {
      if (typeof this.onTimeoutCallback === 'function') {
        this.onTimeoutCallback();
      }
    }, (this.turnTimeoutSec * 1000) + 300);
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  // 시간 초과 시 악어가 화를 내며 현재 차례인 사람을 쾅 물어버림!
  handleTimeout() {
    this.clearTurnTimer();
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || this.room.status !== 'PLAYING') return null;

    this.loserPlayer = currentPlayer;

    const penaltyRole = this.room.settings.roles[0] || '당첨 (벌칙)';
    const safeRole = this.room.settings.roles[1] || '생존 (통과)';

    const results = this.room.players.map(p => ({
      token: p.token,
      nickname: p.nickname,
      isLoser: p.token === currentPlayer.token,
      role: p.token === currentPlayer.token ? `${penaltyRole} (시간 초과!)` : safeRole
    }));

    this.room.finishGame(results);

    return {
      success: true,
      broadcast: true,
      roomId: this.room.id,
      eventName: 'gameFinished',
      data: {
        teethCount: this.teethCount,
        pressedTooth: null,
        isTrap: false,
        isTimeout: true,
        rageLevel: 2,
        loser: {
          token: currentPlayer.token,
          nickname: currentPlayer.nickname
        },
        results,
        room: this.room.toState()
      }
    };
  }

  handleAction(token, action, payload) {
    if (action === 'pressTooth') {
      const currentPlayer = this.getCurrentPlayer();
      if (!currentPlayer || currentPlayer.token !== token) {
        return { success: false, error: '당신의 차례가 아닙니다.' };
      }

      const toothIndex = payload.toothIndex;
      if (toothIndex < 0 || toothIndex >= this.teethCount) {
        return { success: false, error: '유효하지 않은 이빨입니다.' };
      }
      if (this.pressedTeeth.includes(toothIndex)) {
        return { success: false, error: '이미 눌린 이빨입니다.' };
      }

      this.clearTurnTimer();
      this.pressedTeeth.push(toothIndex);

      // 꽝(트랩) 이빨을 눌렀을 때 ➔ 악어가 입을 쾅 닫으며 패배!
      if (toothIndex === this.trapIndex) {
        this.loserPlayer = currentPlayer;
        
        // 내기 벌칙 매칭
        const penaltyRole = this.room.settings.roles[0] || '당첨 (벌칙)';
        const safeRole = this.room.settings.roles[1] || '생존 (통과)';

        const results = this.room.players.map(p => ({
          token: p.token,
          nickname: p.nickname,
          isLoser: p.token === currentPlayer.token,
          role: p.token === currentPlayer.token ? penaltyRole : safeRole
        }));

        this.room.finishGame(results);

        return {
          success: true,
          broadcast: true,
          roomId: this.room.id,
          eventName: 'gameFinished',
          data: {
            teethCount: this.teethCount,
            pressedTooth: toothIndex,
            isTrap: true,
            isTimeout: false,
            rageLevel: 2,
            loser: {
              token: currentPlayer.token,
              nickname: currentPlayer.nickname
            },
            results,
            room: this.room.toState()
          }
        };
      }

      // 안전한 이빨을 눌렀을 때 ➔ 다음 사람으로 턴 넘기기
      this.turnPlayerIndex = (this.turnPlayerIndex + 1) % this.room.players.length;

      return {
        success: true,
        broadcast: true,
        roomId: this.room.id,
        eventName: 'toothPressed',
        data: {
          teethCount: this.teethCount,
          pressedTooth: toothIndex,
          isTrap: false,
          isTimeout: false,
          rageLevel: this.getRageLevel(),
          nextPlayer: {
            token: this.getCurrentPlayer().token,
            nickname: this.getCurrentPlayer().nickname
          },
          room: this.room.toState()
        }
      };
    }

    return { success: false, error: '알 수 없는 동작입니다.' };
  }

  destroy() {
    this.clearTurnTimer();
    this.pressedTeeth = [];
  }

  toState() {
    return {
      teethCount: this.teethCount,
      pressedTeeth: this.pressedTeeth,
      remainingCount: this.teethCount - this.pressedTeeth.length,
      currentTurnToken: this.getCurrentPlayer() ? this.getCurrentPlayer().token : null,
      currentTurnNickname: this.getCurrentPlayer() ? this.getCurrentPlayer().nickname : '',
      loserPlayer: this.loserPlayer,
      turnTimeoutSec: this.turnTimeoutSec,
      turnExpiresAt: this.turnExpiresAt,
      rageLevel: this.getRageLevel()
    };
  }
}

module.exports = CrocodileGame;
