const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../server/models/Room');

describe('🏠 공통 Room 라이프사이클 및 설정 테스트', () => {
  let room;

  beforeEach(() => {
    room = new Room('ABCD', '방장김철수', 'socket-1');
  });

  it('방 생성 시 초기 상태와 방장 권한이 올바르게 설정되어야 한다', () => {
    assert.strictEqual(room.id, 'ABCD');
    assert.strictEqual(room.status, 'LOBBY');
    assert.strictEqual(room.players.length, 1);
    assert.strictEqual(room.players[0].isHost, true);
    assert.strictEqual(room.players[0].nickname, '방장김철수');
    assert.strictEqual(room.isHost(room.players[0].token), true);
  });

  it('참가자가 들어오면 목록에 추가되어야 한다', () => {
    const res = room.addOrReconnectPlayer('socket-2', '이영희');
    assert.strictEqual(res.success, true);
    assert.strictEqual(room.players.length, 2);
    assert.strictEqual(res.player.nickname, '이영희');
    assert.strictEqual(res.player.isHost, false);
  });

  it('1명일 때는 게임을 시작할 수 없어야 한다', () => {
    const startRes = room.startGame();
    assert.strictEqual(startRes.success, false);
    assert.strictEqual(startRes.error, '최소 2명 이상 모여야 게임을 시작할 수 있습니다.');
  });

  it('2명 이상일 때 게임을 시작하고 LOBBY로 리셋할 수 있어야 한다', () => {
    room.addOrReconnectPlayer('socket-2', '이영희');
    const startRes = room.startGame();
    assert.strictEqual(startRes.success, true);
    assert.strictEqual(room.status, 'PLAYING');
    assert.ok(room.activeGame);

    const resetRes = room.resetToLobby();
    assert.strictEqual(resetRes.success, true);
    assert.strictEqual(room.status, 'LOBBY');
    assert.strictEqual(room.activeGame, null);
  });

  it('기존 토큰을 가진 플레이어는 재연결(Reconnect)이 지원되어야 한다', () => {
    const joinRes = room.addOrReconnectPlayer('socket-2', '이영희');
    const token = joinRes.player.token;

    // 소켓 끊김 시뮬레이션 후 새 소켓으로 재연결
    const reconRes = room.addOrReconnectPlayer('socket-new', '이영희(복귀)', token);
    assert.strictEqual(reconRes.success, true);
    assert.strictEqual(reconRes.isReconnect, true);
    assert.strictEqual(reconRes.player.socketId, 'socket-new');
    assert.strictEqual(room.players.length, 2); // 인원수 증가 없음
  });
});
