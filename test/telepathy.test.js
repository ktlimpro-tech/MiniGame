const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../server/models/Room');
const TelepathyGame = require('../server/games/telepathy');

describe('🧠 2호 협동 게임: 침묵의 텔레파시 (TelepathyGame) 단위 테스트', () => {
  let room;
  let game;
  let p1;
  let p2;

  beforeEach(() => {
    room = new Room('TELE', '방장', 'socket-host');
    room.updateSettings({
      gameType: 'telepathy',
      cardsPerPlayer: 4,
      roles: ['커피 쏘기! ☕', '생존']
    });
    room.addOrReconnectPlayer('socket-player2', '영희');
    p1 = room.players[0];
    p2 = room.players[1];
    room.startGame();
    game = room.activeGame;
  });

  it('게임 시작 시 2인 기준 하트 2개와 각 플레이어별 4장의 고유 카드가 오름차순 정렬되어 지급되어야 한다', () => {
    assert.ok(game instanceof TelepathyGame);
    assert.strictEqual(game.hearts, 2);
    assert.strictEqual(game.maxHearts, 2);
    assert.strictEqual(game.status, 'PLAYING');

    // 2인 플레이 시 1인당 4장 = 총 8장
    const cards1 = game.playerCards.get(p1.token);
    const cards2 = game.playerCards.get(p2.token);
    assert.strictEqual(cards1.length, 4);
    assert.strictEqual(cards2.length, 4);

    // 오름차순 정렬 검증
    for (let i = 0; i < cards1.length - 1; i++) {
      assert.ok(cards1[i] < cards1[i + 1]);
    }
    for (let i = 0; i < cards2.length - 1; i++) {
      assert.ok(cards2[i] < cards2[i + 1]);
    }

    // 중복 카드 없음 검증
    const allCards = [...cards1, ...cards2];
    const uniqueCards = new Set(allCards);
    assert.strictEqual(uniqueCards.size, allCards.length);
  });

  it('보안 검증: toState(targetToken)는 본인의 비밀 숫자만 노출하고 타인의 카드는 은닉해야 한다', () => {
    const stateP1 = game.toState(p1.token);
    const stateP2 = game.toState(p2.token);

    // p1 시점에서는 p1의 myCards만 보임
    assert.deepStrictEqual(stateP1.myCards, game.playerCards.get(p1.token));
    // p1 시점에서 p2의 핸드 카드는 숫자 대신 장수(playerHandCounts)로만 노출
    assert.strictEqual(stateP1.playerHandCounts[p2.token], 4);

    // p2 시점에서는 p2의 myCards만 보임
    assert.deepStrictEqual(stateP2.myCards, game.playerCards.get(p2.token));
    assert.notDeepStrictEqual(stateP1.myCards, stateP2.myCards);
  });

  it('가장 작은 카드를 정상적으로 순서대로 낼 경우 성공적으로 처리되어야 한다', () => {
    // 테스트용으로 패를 직접 설정
    game.playerCards.set(p1.token, [10, 50]);
    game.playerCards.set(p2.token, [20, 80]);

    // p1이 10을 냄 (전체에서 가장 작음 -> 성공)
    const res1 = game.handleAction(p1.token, 'playCard');
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.data.mistake, false);
    assert.strictEqual(res1.data.playedCard, 10);
    assert.strictEqual(game.discardPile[game.discardPile.length - 1].number, 10);
    assert.strictEqual(game.hearts, 2); // 2인 기준 하트 2개 보존

    // 남은 전체 카드 수 3개
    assert.strictEqual(game.getTotalRemainingCards(), 3);
  });

  it('더 작은 카드를 가진 팀원이 있음에도 큰 카드를 먼저 내면 실수(하트 -1) 처리되고 작은 카드가 폐기되어야 한다', () => {
    // p1: [50, 90], p2: [20, 80]
    game.playerCards.set(p1.token, [50, 90]);
    game.playerCards.set(p2.token, [20, 80]);

    // p1이 50을 먼저 냄 (p2가 20을 쥐고 있었음!)
    const res = game.handleAction(p1.token, 'playCard');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.eventName, 'telepathyCardPlayed');
    assert.strictEqual(res.data.mistake, true);
    assert.strictEqual(game.hearts, 1); // 2인 기준 하트 2개 중 1개 깎여서 1개 남음!
    assert.strictEqual(res.data.skippedCards.length, 1);
    assert.strictEqual(res.data.skippedCards[0].number, 20);

    // 20은 건너뛰어졌으므로 p2의 손패에는 80만 남게 됨
    assert.deepStrictEqual(game.playerCards.get(p2.token), [80]);
  });

  it('하트가 모두 소진되면 게임 오버(실패)가 되어야 한다', () => {
    game.hearts = 1;
    game.playerCards.set(p1.token, [90]);
    game.playerCards.set(p2.token, [10]);

    // p1이 실수 발생 -> 하트 0으로 소진
    const res = game.handleAction(p1.token, 'playCard');
    assert.strictEqual(res.success, true);
    assert.strictEqual(game.hearts, 0);
    assert.strictEqual(game.status, 'FAILED');
    assert.strictEqual(res.data.isSuccess, false);
    assert.strictEqual(room.status, 'RESULT');
  });

  it('모든 카드를 순서대로 다 냈을 때 협동 승리(대성공)가 되어야 한다', () => {
    game.playerCards.set(p1.token, [10]);
    game.playerCards.set(p2.token, [20]);

    // 1) p1이 10 냄
    game.handleAction(p1.token, 'playCard');
    assert.strictEqual(game.status, 'PLAYING');

    // 2) p2가 20 냄 -> 모든 카드 소진
    const res2 = game.handleAction(p2.token, 'playCard');
    assert.strictEqual(res2.success, true);
    assert.strictEqual(game.status, 'SUCCESS');
    assert.strictEqual(res2.data.isSuccess, true);
    assert.strictEqual(room.status, 'RESULT');
  });

  it('실수로 인해 동료의 카드가 스킵되어 0장이 된 경우 성공이 아니라 실패(FAILED)로 끝나야 한다', () => {
    // p1: [80], p2: [10] (하트가 2개 남아있어도 실수가 발생하여 카드가 날아감)
    game.hearts = 2;
    game.playerCards.set(p1.token, [80]);
    game.playerCards.set(p2.token, [10]);

    // p1이 80을 냄 -> p2의 10이 스킵되어 양쪽 다 0장이 됨
    const res = game.handleAction(p1.token, 'playCard');
    assert.strictEqual(res.success, true);
    assert.strictEqual(game.status, 'FAILED');
    assert.strictEqual(res.data.isSuccess, false);
    assert.strictEqual(room.status, 'RESULT');
    assert.strictEqual(res.data.loser.token, p1.token);
  });

  it('손패가 없는 플레이어가 카드를 내려고 하면 에러를 반환해야 한다', () => {
    game.playerCards.set(p1.token, []);
    const res = game.handleAction(p1.token, 'playCard');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, '남은 카드가 없습니다.');
  });

  it('텔레파시 게임 종료(RESULT) 후 대기실로 리셋(resetToLobby)이 오류 없이 성공해야 한다', () => {
    // 게임 종료 상태 만들기
    game.hearts = 0;
    room.finishGame([{ token: p1.token, isLoser: true }]);
    assert.strictEqual(room.status, 'RESULT');

    // clearTurnTimer 호출 안전성 검증
    assert.doesNotThrow(() => {
      if (room.activeGame && typeof room.activeGame.clearTurnTimer === 'function') {
        room.activeGame.clearTurnTimer();
      }
    });

    // resetToLobby 실행
    const resetRes = room.resetToLobby();
    assert.strictEqual(resetRes.success, true);
    assert.strictEqual(room.status, 'LOBBY');
    assert.strictEqual(room.activeGame, null);
  });

  it('방장이 cardsPerPlayer를 3으로 설정했을 때 인당 3장씩 정상 분배되어야 한다', () => {
    const customRoom = new Room('CUST', '방장', 'sock-1');
    customRoom.updateSettings({
      gameType: 'telepathy',
      cardsPerPlayer: 3
    });
    customRoom.addOrReconnectPlayer('sock-2', '영희');
    customRoom.startGame();

    const tGame = customRoom.activeGame;
    assert.strictEqual(tGame.cardsPerPlayer, 3);
    assert.strictEqual(tGame.playerCards.get(customRoom.players[0].token).length, 3);
    assert.strictEqual(tGame.playerCards.get(customRoom.players[1].token).length, 3);
  });

  it('6인 다인원 방에서는 숫자 간격 유지를 위해 최대 2장으로 캡(Cap)이 적용되어야 한다', () => {
    const bigRoom = new Room('BIGR', '방장', 'sock-1');
    bigRoom.updateSettings({
      gameType: 'telepathy',
      cardsPerPlayer: 4 // 방장이 4장(무리한 설정)을 시도
    });
    for (let i = 2; i <= 6; i++) {
      bigRoom.addOrReconnectPlayer(`sock-${i}`, `유저${i}`);
    }
    assert.strictEqual(bigRoom.players.length, 6);
    bigRoom.startGame();

    const tGame = bigRoom.activeGame;
    // 6인이므로 4장이 아니라 2장으로 안전 캡 적용!
    assert.strictEqual(tGame.cardsPerPlayer, 2);
    assert.strictEqual(tGame.playerCards.get(bigRoom.players[0].token).length, 2);
  });
});
