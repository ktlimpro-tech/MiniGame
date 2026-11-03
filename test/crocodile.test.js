const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../server/models/Room');
const CrocodileGame = require('../server/games/crocodile');

describe('🐊 1호 게임: 악어 이빨 (CrocodileGame) 단위 테스트', () => {
  let room;
  let game;

  beforeEach(() => {
    room = new Room('TEST', '방장', 'socket-host');
    room.addOrReconnectPlayer('socket-player2', '철수');
    room.startGame();
    game = room.activeGame;
  });

  it('게임 시작 시 방 인원수에 맞춰 이빨 개수와 트랩 인덱스가 올바르게 초기화되어야 한다', () => {
    assert.strictEqual(game.teethCount, 10); // 2인: 10개
    assert.ok(game.trapIndex >= 0 && game.trapIndex < game.teethCount);
    assert.strictEqual(game.pressedTeeth.length, 0);
    assert.ok(game.turnPlayerIndex >= 0 && game.turnPlayerIndex < room.players.length);
    assert.strictEqual(game.loserPlayer, null);
  });

  it('본인 차례가 아닌 플레이어의 행동은 거부되어야 한다', () => {
    const currentTurn = game.getCurrentPlayer();
    const otherPlayer = room.players.find(p => p.token !== currentTurn.token);
    const res = game.handleAction(otherPlayer.token, 'pressTooth', { toothIndex: 0 });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, '당신의 차례가 아닙니다.');
  });

  it('유효하지 않거나 이미 눌린 이빨 인덱스는 거부되어야 한다', () => {
    const currentTurn = game.getCurrentPlayer();
    const otherPlayer = room.players.find(p => p.token !== currentTurn.token);

    const res1 = game.handleAction(currentTurn.token, 'pressTooth', { toothIndex: 99 });
    assert.strictEqual(res1.success, false);
    assert.strictEqual(res1.error, '유효하지 않은 이빨입니다.');

    // 한 개 누름 (안전한 이빨)
    const safeTooth = (game.trapIndex + 1) % game.teethCount;
    game.handleAction(currentTurn.token, 'pressTooth', { toothIndex: safeTooth });

    // 이제 턴이 otherPlayer로 넘어감. 그 플레이어가 동일한 이빨을 다시 누를 때
    const res2 = game.handleAction(otherPlayer.token, 'pressTooth', { toothIndex: safeTooth });
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.error, '이미 눌린 이빨입니다.');
  });

  it('안전한 이빨을 누르면 턴이 다음 플레이어에게 넘어가야 한다', () => {
    const currentTurn = game.getCurrentPlayer();
    const otherPlayer = room.players.find(p => p.token !== currentTurn.token);
    const safeTooth = (game.trapIndex + 1) % game.teethCount;

    const res = game.handleAction(currentTurn.token, 'pressTooth', { toothIndex: safeTooth });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.eventName, 'toothPressed');
    assert.strictEqual(res.data.isTrap, false);
    assert.strictEqual(game.getCurrentPlayer().token, otherPlayer.token);
    assert.ok(game.pressedTeeth.includes(safeTooth));
  });

  it('꽝 이빨(트랩)을 누르면 게임이 종료되고 누른 사람이 패배자로 확정되어야 한다', () => {
    const currentTurn = game.getCurrentPlayer();
    const trapTooth = game.trapIndex;

    const res = game.handleAction(currentTurn.token, 'pressTooth', { toothIndex: trapTooth });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.eventName, 'gameFinished');
    assert.strictEqual(res.data.isTrap, true);
    assert.strictEqual(res.data.loser.token, currentTurn.token);
    assert.strictEqual(room.status, 'RESULT');
    assert.strictEqual(room.gameResults.find(r => r.token === currentTurn.token).isLoser, true);
  });

  it('남은 이빨 수에 따라 악어의 분노 단계(0, 1, 2)가 올바르게 계산되어야 한다', () => {
    // 10개 이빨: 초기 분노 0단계 (평온)
    assert.strictEqual(game.getRageLevel(), 0);

    // 이빨 4개 눌러서 남은 이빨 6개 ➔ 분노 1단계 (경계)
    game.pressedTeeth = [0, 1, 2, 3];
    assert.strictEqual(game.getRageLevel(), 1);

    // 이빨 7개 눌러서 남은 이빨 3개 ➔ 분노 2단계 (극도 분노/폭주)
    game.pressedTeeth = [0, 1, 2, 3, 4, 5, 6];
    assert.strictEqual(game.getRageLevel(), 2);
  });

  it('5초 타임아웃 발생 시 현재 턴 플레이어가 즉시 패배자로 확정되어야 한다', () => {
    const currentTurn = game.getCurrentPlayer();
    const timeoutRes = game.handleTimeout();

    assert.strictEqual(timeoutRes.success, true);
    assert.strictEqual(timeoutRes.eventName, 'gameFinished');
    assert.strictEqual(timeoutRes.data.isTimeout, true);
    assert.strictEqual(timeoutRes.data.loser.token, currentTurn.token);
    assert.strictEqual(room.status, 'RESULT');
    assert.strictEqual(room.gameResults.find(r => r.token === currentTurn.token).isLoser, true);
  });
});
