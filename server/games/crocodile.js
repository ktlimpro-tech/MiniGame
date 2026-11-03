class CrocodileGame {
  constructor(room) {
    this.room = room;
    this.teethCount = 12; // 악어 이빨 12개
    this.trapIndex = -1;  // 꽝 이빨 인덱스 (0 ~ 11)
    this.pressedTeeth = []; // 이미 누른 이빨 인덱스 목록
    this.turnPlayerIndex = 0; // 현재 턴 플레이어 인덱스
    this.loserPlayer = null; // 물린 패배자
  }

  init() {
    this.teethCount = Math.max(10, this.room.players.length * 3); // 인원수에 맞춰 이빨 갯수 조정
    this.trapIndex = Math.floor(Math.random() * this.teethCount);
    this.pressedTeeth = [];
    this.turnPlayerIndex = 0;
    this.loserPlayer = null;
    console.log(`[Crocodile] Initialized with ${this.teethCount} teeth. Trap index: ${this.trapIndex}`);
  }

  getCurrentPlayer() {
    return this.room.players[this.turnPlayerIndex];
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
    this.pressedTeeth = [];
  }

  toState() {
    return {
      teethCount: this.teethCount,
      pressedTeeth: this.pressedTeeth,
      currentTurnToken: this.getCurrentPlayer() ? this.getCurrentPlayer().token : null,
      currentTurnNickname: this.getCurrentPlayer() ? this.getCurrentPlayer().nickname : '',
      loserPlayer: this.loserPlayer
    };
  }
}

module.exports = CrocodileGame;
