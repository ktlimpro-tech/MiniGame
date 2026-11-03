const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../server/models/Room');
const BalanceGame = require('../server/games/balance');

describe('🤝 3호 밸런스 게임: 이심전심 밸런스 (BalanceGame) 단위 테스트', () => {
  let room2p;
  let room3p;
  let room4p;

  beforeEach(() => {
    // 2인 방
    room2p = new Room('BAL2', '철수', 'socket-host-2p');
    room2p.addOrReconnectPlayer('socket-p2', '영희');
    room2p.updateSettings({
      gameType: 'balance',
      balanceSubMode: 'couple',
      roles: ['커피 쏘기! ☕', '생존']
    });

    // 3인 방
    room3p = new Room('BAL3', '철수', 'socket-host-3p');
    room3p.addOrReconnectPlayer('socket-p2-3p', '영희');
    room3p.addOrReconnectPlayer('socket-p3-3p', '민수');
    room3p.updateSettings({
      gameType: 'balance',
      balanceSubMode: 'minority',
      roles: ['커피 쏘기! ☕', '생존']
    });

    // 4인 방
    room4p = new Room('BAL4', '철수', 'socket-host-4p');
    room4p.addOrReconnectPlayer('socket-p2-4p', '영희');
    room4p.addOrReconnectPlayer('socket-p3-4p', '민수');
    room4p.addOrReconnectPlayer('socket-p4-4p', '지수');
    room4p.updateSettings({
      gameType: 'balance',
      balanceSubMode: 'minority',
      roles: ['커피 쏘기! ☕', '생존']
    });
  });

  it('데이터베이스 검증: 85개 이상의 엄선된 밸런스 질문이 정상 로드되어야 한다', () => {
    room2p.startGame();
    const game = room2p.activeGame;
    assert.ok(game instanceof BalanceGame);
    assert.ok(game.questionsPool.length >= 85, `질문 개수 부족: ${game.questionsPool.length}`);
    assert.ok(game.currentQuestion.id);
    assert.ok(game.currentQuestion.question);
    assert.ok(game.currentQuestion.optionA);
    assert.ok(game.currentQuestion.optionB);
  });

  it('보안 검증: 투표 진행 중에는 타인의 선택이 null로 은닉되고, 본인 선택만 노출되어야 한다', () => {
    room2p.startGame();
    const game = room2p.activeGame;
    const p1 = room2p.players[0];
    const p2 = room2p.players[1];

    // p1 투표
    const voteRes = game.handleAction(p1.token, 'vote', { option: 'A' });
    assert.strictEqual(voteRes.eventName, 'balanceVoteProgress');
    assert.strictEqual(game.isRevealed, false);

    // p1 시점 상태
    const stateP1 = game.toState(p1.token);
    assert.strictEqual(stateP1.myVote, 'A');
    const p1InState = stateP1.players.find(p => p.token === p1.token);
    const p2InState = stateP1.players.find(p => p.token === p2.token);
    assert.strictEqual(p1InState.choice, 'A');
    assert.strictEqual(p2InState.choice, null, '타인의 선택은 은닉되어야 함');

    // p2 시점 상태
    const stateP2 = game.toState(p2.token);
    assert.strictEqual(stateP2.myVote, null);
    const p1ForP2 = stateP2.players.find(p => p.token === p1.token);
    assert.strictEqual(p1ForP2.choice, null, 'p2 시점에서도 p1의 선택은 은닉되어야 함');
  });

  describe('❤️ [2인 커플 모드] 3라운드 승패 로직 테스트', () => {
    it('3문제 중 2문제 이상 일치 시 최종 성공(벌칙 면제)해야 한다', () => {
      room2p.startGame();
      const game = room2p.activeGame;
      const p1 = room2p.players[0];
      const p2 = room2p.players[1];

      assert.strictEqual(game.subMode, 'couple');
      assert.strictEqual(game.round, 1);
      assert.strictEqual(game.maxRounds, 3);

      // Round 1: 둘 다 A 선택 (일치 -> matchCount = 1)
      game.handleAction(p1.token, 'vote', { option: 'A' });
      const r1Res = game.handleAction(p2.token, 'vote', { option: 'A' });
      assert.strictEqual(r1Res.eventName, 'balanceRoundRevealed');
      assert.strictEqual(game.matchCount, 1);
      assert.strictEqual(game.status, 'PLAYING');

      // Next Round (방장 p1 조작)
      const next1Res = game.handleAction(p1.token, 'nextRound', {});
      assert.strictEqual(next1Res.eventName, 'balanceNextQuestion');
      assert.strictEqual(game.round, 2);

      // Round 2: p1: A, p2: B (불일치 -> matchCount = 1)
      game.handleAction(p1.token, 'vote', { option: 'A' });
      const r2Res = game.handleAction(p2.token, 'vote', { option: 'B' });
      assert.strictEqual(r2Res.eventName, 'balanceRoundRevealed');
      assert.strictEqual(game.matchCount, 1);

      // Next Round
      game.handleAction(p1.token, 'nextRound', {});
      assert.strictEqual(game.round, 3);

      // Round 3: 둘 다 B 선택 (일치 -> matchCount = 2 -> 게임 완료 및 최종 성공!)
      game.handleAction(p1.token, 'vote', { option: 'B' });
      const r3Res = game.handleAction(p2.token, 'vote', { option: 'B' });
      assert.strictEqual(r3Res.eventName, 'balanceFinished');
      assert.strictEqual(game.status, 'FINISHED');
      assert.strictEqual(r3Res.data.isSuccess, true);
      assert.strictEqual(r3Res.data.matchCount, 2);
      assert.strictEqual(room2p.status, 'RESULT');
      assert.ok(room2p.gameResults.every(r => r.isLoser === false));
    });

    it('3문제 중 1문제만 일치 시 최종 실패(두 사람 모두 벌칙)해야 한다', () => {
      room2p.startGame();
      const game = room2p.activeGame;
      const p1 = room2p.players[0];
      const p2 = room2p.players[1];

      // Round 1: p1: A, p2: B (불일치)
      game.handleAction(p1.token, 'vote', { option: 'A' });
      game.handleAction(p2.token, 'vote', { option: 'B' });

      // Round 2: p1: A, p2: A (일치 -> matchCount = 1)
      game.handleAction(p1.token, 'nextRound', {});
      game.handleAction(p1.token, 'vote', { option: 'A' });
      game.handleAction(p2.token, 'vote', { option: 'A' });

      // Round 3: p1: B, p2: A (불일치 -> matchCount = 1 -> 실패)
      game.handleAction(p1.token, 'nextRound', {});
      game.handleAction(p1.token, 'vote', { option: 'B' });
      const finalRes = game.handleAction(p2.token, 'vote', { option: 'A' });

      assert.strictEqual(finalRes.eventName, 'balanceFinished');
      assert.strictEqual(finalRes.data.isSuccess, false);
      assert.strictEqual(finalRes.data.matchCount, 1);
      assert.ok(room2p.gameResults.every(r => r.isLoser === true));
    });
  });

  describe('🔥 [3인 이상 소수파 벌칙 모드] 승패 및 동률 로직 테스트', () => {
    it('3인 중 2명이 A, 1명이 B 선택 시 B를 선택한 1명이 소수파 벌칙자로 결정되어야 한다', () => {
      room3p.startGame();
      const game = room3p.activeGame;
      const [p1, p2, p3] = room3p.players;

      assert.strictEqual(game.subMode, 'minority');

      // p1, p2는 A 선택 / p3은 B 선택
      game.handleAction(p1.token, 'vote', { option: 'A' });
      game.handleAction(p2.token, 'vote', { option: 'A' });
      const res = game.handleAction(p3.token, 'vote', { option: 'B' });

      assert.strictEqual(res.eventName, 'balanceFinished');
      assert.strictEqual(game.status, 'FINISHED');
      assert.strictEqual(res.data.isUnanimous, false);
      assert.strictEqual(res.data.isDraw, false);
      assert.strictEqual(res.data.loser.nickname, p3.nickname);

      // Room gameResults 검증
      const p3Result = room3p.gameResults.find(r => r.token === p3.token);
      const p1Result = room3p.gameResults.find(r => r.token === p1.token);
      assert.strictEqual(p3Result.isLoser, true);
      assert.strictEqual(p1Result.isLoser, false);
    });

    it('3인 전원이 A를 선택하면 만장일치 대성공(전원 생존) 처리되어야 한다', () => {
      room3p.startGame();
      const game = room3p.activeGame;
      const [p1, p2, p3] = room3p.players;

      game.handleAction(p1.token, 'vote', { option: 'A' });
      game.handleAction(p2.token, 'vote', { option: 'A' });
      const res = game.handleAction(p3.token, 'vote', { option: 'A' });

      assert.strictEqual(res.eventName, 'balanceFinished');
      assert.strictEqual(res.data.isUnanimous, true);
      assert.strictEqual(res.data.isSuccess, true);
      assert.strictEqual(res.data.loser, null);
      assert.ok(room3p.gameResults.every(r => r.isLoser === false));
    });

    it('4인 플레이에서 2:2 동률이 발생하면 황금 밸런스 무승부(벌칙 없음) 처리되어야 한다', () => {
      room4p.startGame();
      const game = room4p.activeGame;
      const [p1, p2, p3, p4] = room4p.players;

      // 2명 A, 2명 B
      game.handleAction(p1.token, 'vote', { option: 'A' });
      game.handleAction(p2.token, 'vote', { option: 'A' });
      game.handleAction(p3.token, 'vote', { option: 'B' });
      const res = game.handleAction(p4.token, 'vote', { option: 'B' });

      assert.strictEqual(res.eventName, 'balanceFinished');
      assert.strictEqual(res.data.isDraw, true);
      assert.strictEqual(res.data.isSuccess, false);
      assert.strictEqual(res.data.lastResult.isDraw, true);
      assert.ok(room4p.gameResults.every(r => r.isLoser === false));
    });
  });

  it('대기실 리셋 검증: resetToLobby 실행 시 타이머 및 상태가 안전하게 초기화되어야 한다', () => {
    room2p.startGame();
    const res = room2p.resetToLobby();
    assert.strictEqual(res.success, true);
    assert.strictEqual(room2p.status, 'LOBBY');
    assert.strictEqual(room2p.activeGame, null);
  });
});
