/**
 * 2호 게임: 침묵의 텔레파시 (The Mind 스타일 협동 카드 내기)
 * 
 * [룰 요약]
 * - 1부터 100까지의 고유한 숫자 카드를 플레이어들에게 무작위로 배분합니다.
 * - 말을 하지 않고, 오직 눈치와 타이밍으로 '작은 수부터 큰 수' 순서대로 카드를 제출합니다.
 * - 누군가 카드를 냈을 때 다른 사람이 더 작은 카드를 쥐고 있었다면 하트가 1개 차감됩니다.
 * - 하트 3개가 다 닳기 전에 모든 카드를 다 털어내면 전원 미션 성공!
 */
class TelepathyGame {
  constructor(room) {
    this.room = room;
    this.maxHearts = 3;
    this.hearts = 3;
    this.cardsPerPlayer = 2; // 기본 1인당 2장
    this.playerCards = new Map(); // token -> [numbers] (오름차순)
    this.discardPile = []; // [{ token, nickname, number, isError }]
    this.lastPlayedCard = null; // { nickname, number, isSuccess }
    this.status = 'PLAYING'; // 'PLAYING', 'SUCCESS', 'FAILED'
    this.gameResult = null;
  }

  init() {
    const playerCount = this.room.players.length;
    // 인원수가 많으면(5인 이상) 1인당 1장, 적으면 2장
    this.cardsPerPlayer = playerCount >= 5 ? 1 : 2;
    this.hearts = 3;
    this.discardPile = [];
    this.lastPlayedCard = null;
    this.status = 'PLAYING';
    this.gameResult = null;

    // 1부터 100까지 중복 없는 난수 카드 덱 생성 후 셔플
    const deck = Array.from({ length: 100 }, (_, i) => i + 1);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // 플레이어별 카드 분배 및 오름차순 정렬
    this.playerCards.clear();
    for (const player of this.room.players) {
      const hand = deck.splice(0, this.cardsPerPlayer).sort((a, b) => a - b);
      this.playerCards.set(player.token, hand);
    }

    console.log(`[Telepathy] Initialized for ${playerCount} players. Cards per player: ${this.cardsPerPlayer}`);
  }

  // 전체 남은 카드 개수
  getTotalRemainingCards() {
    let count = 0;
    for (const hand of this.playerCards.values()) {
      count += hand.length;
    }
    return count;
  }

  // 플레이어의 카드 제출 처리
  handleAction(token, action, payload) {
    if (this.status !== 'PLAYING') {
      return { success: false, error: '현재 진행 중인 게임이 아닙니다.' };
    }

    const player = this.room.players.find(p => p.token === token);
    if (!player) {
      return { success: false, error: '방에 속한 플레이어가 아닙니다.' };
    }

    if (action === 'playCard') {
      const hand = this.playerCards.get(token) || [];
      if (hand.length === 0) {
        return { success: false, error: '남은 카드가 없습니다.' };
      }

      // 플레이어가 가진 카드 중 가장 작은 카드(맨 앞)를 냄
      const playedNumber = hand.shift(); // 낸 카드 꺼내기

      // [핵심 검증]: 다른 플레이어가 방금 낸 카드보다 더 작은 카드를 쥐고 있는지 검사
      const skippedCards = [];
      for (const [otherToken, otherHand] of this.playerCards.entries()) {
        const otherPlayer = this.room.players.find(p => p.token === otherToken);
        // 방금 낸 수보다 작은 카드들을 모두 찾아내서 버림(스킵) 처리
        while (otherHand.length > 0 && otherHand[0] < playedNumber) {
          const skippedNum = otherHand.shift();
          skippedCards.push({
            token: otherToken,
            nickname: otherPlayer ? otherPlayer.nickname : '알 수 없음',
            number: skippedNum
          });
        }
      }

      const isError = skippedCards.length > 0;

      if (isError) {
        // 실패: 하트 1개 차감
        this.hearts = Math.max(0, this.hearts - 1);
        console.log(`[Telepathy] 실수 발생! ${player.nickname}이(가) ${playedNumber}을 냈으나, 더 작은 카드 [${skippedCards.map(s => s.nickname + ':' + s.number).join(', ')}]가 남아있었습니다. 남은 하트: ${this.hearts}`);
      }

      // 제출 기록 추가
      this.lastPlayedCard = {
        token: player.token,
        nickname: player.nickname,
        number: playedNumber,
        isError,
        skippedCards
      };

      this.discardPile.push(this.lastPlayedCard);

      // 1. 하트 소진 ➔ 게임 오버 (미션 실패)
      if (this.hearts <= 0) {
        this.status = 'FAILED';
        const results = this.room.players.map(p => ({
          token: p.token,
          nickname: p.nickname,
          isLoser: p.token === player.token, // 마지막으로 실수한 사람을 주 패배자로 표시
          role: '팀 미션 실패 (하트 소진)'
        }));
        this.room.finishGame(results);

        return {
          success: true,
          broadcast: true,
          roomId: this.room.id,
          eventName: 'telepathyFinished',
          data: {
            isSuccess: false,
            loser: { token: player.token, nickname: player.nickname },
            reason: '하트가 모두 소진되었습니다!',
            lastCard: this.lastPlayedCard,
            hearts: this.hearts,
            discardPile: this.discardPile,
            room: this.room.toState()
          }
        };
      }

      // 2. 모든 카드가 소진되었는지 확인 ➔ 미션 대성공!
      const remainingTotal = this.getTotalRemainingCards();
      if (remainingTotal === 0) {
        this.status = 'SUCCESS';
        const results = this.room.players.map(p => ({
          token: p.token,
          nickname: p.nickname,
          isLoser: false, // 전원 승리!
          role: `팀 미션 대성공! (하트 ${this.hearts}개 보존)`
        }));
        this.room.finishGame(results);

        return {
          success: true,
          broadcast: true,
          roomId: this.room.id,
          eventName: 'telepathyFinished',
          data: {
            isSuccess: true,
            loser: null,
            reason: '축하합니다! 전원 텔레파시로 모든 카드를 완벽하게 제출했습니다!',
            lastCard: this.lastPlayedCard,
            hearts: this.hearts,
            discardPile: this.discardPile,
            room: this.room.toState()
          }
        };
      }

      // 3. 정상 진행 중 (카드 1장 성공 또는 하트 1개 깎이고 계속)
      return {
        success: true,
        broadcast: true,
        roomId: this.room.id,
        eventName: 'telepathyCardPlayed',
        data: {
          nickname: player.nickname,
          playedCard: playedNumber,
          mistake: isError,
          skippedCards,
          lastCard: this.lastPlayedCard,
          isError,
          hearts: this.hearts,
          remainingTotal,
          discardPile: this.discardPile,
          room: this.room.toState()
        }
      };
    }

    return { success: false, error: '알 수 없는 동작입니다.' };
  }

  destroy() {
    this.playerCards.clear();
    this.discardPile = [];
  }

  // 상태 직렬화:
  // 보안을 위해 타인의 패는 비공개(남은 카드 수만), 본인의 패만 전달할 수 있도록 지원
  toState(targetToken = null) {
    const playerHandCounts = {};
    let myCards = [];

    const playersState = this.room.players.map(p => {
      const hand = this.playerCards.get(p.token) || [];
      const isMe = targetToken && p.token === targetToken;
      playerHandCounts[p.token] = hand.length;
      if (isMe) {
        myCards = [...hand];
      }
      return {
        token: p.token,
        nickname: p.nickname,
        remainingCount: hand.length,
        // 본인일 때만 실제 숫자 카드 배열 공개, 타인은 감춤
        myCards: isMe ? [...hand] : []
      };
    });

    return {
      gameType: 'telepathy',
      hearts: this.hearts,
      maxHearts: this.maxHearts,
      totalRemaining: this.getTotalRemainingCards(),
      lastPlayedCard: this.lastPlayedCard ? this.lastPlayedCard.number : null,
      lastPlayedByNickname: this.lastPlayedCard ? this.lastPlayedCard.nickname : null,
      lastPlayedDetail: this.lastPlayedCard,
      discardPile: this.discardPile,
      status: this.status,
      isSuccess: this.status === 'SUCCESS',
      isGameOver: this.status === 'SUCCESS' || this.status === 'FAILED',
      players: playersState,
      playerHandCounts,
      myCards
    };
  }
}

module.exports = TelepathyGame;
