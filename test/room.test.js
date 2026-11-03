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

  it('서로 다른 토큰을 가진 독립된 플레이어 2명이 입장하면 방 인원은 2명이 되어야 한다', () => {
    // 플레이어 1: 방장
    assert.strictEqual(room.players.length, 1);
    
    // 플레이어 2: 새 플레이어 (token 없이 신규 입장)
    const joinRes2 = room.addOrReconnectPlayer('socket-guest', '게스트1');
    assert.strictEqual(joinRes2.success, true);
    assert.strictEqual(joinRes2.isReconnect, false);
    assert.strictEqual(room.players.length, 2);

    // 플레이어 3: 또 다른 플레이어
    const joinRes3 = room.addOrReconnectPlayer('socket-guest2', '게스트2');
    assert.strictEqual(joinRes3.success, true);
    assert.strictEqual(room.players.length, 3);
  });

  it('중복된 닉네임으로 입장 시 (2), (3) 번호가 자동으로 부여되어야 한다', () => {
    // 이미 '방장김철수'가 있음
    const res1 = room.addOrReconnectPlayer('socket-2', '방장김철수');
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.player.nickname, '방장김철수(2)');

    // 한 번 더 동일 닉네임 입장 (공백 포함된 형태)
    const res2 = room.addOrReconnectPlayer('socket-3', '  방장김철수  ');
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.player.nickname, '방장김철수(3)');

    // 영문 대소문자 중복 체크
    room.addOrReconnectPlayer('socket-4', 'IronMan');
    const res3 = room.addOrReconnectPlayer('socket-5', 'ironman');
    assert.strictEqual(res3.player.nickname, 'ironman(2)');
  });

  it('대기실에서 벌칙 및 설정을 변경하면 즉시 반영되어야 한다', () => {
    const updateRes = room.updateSettings({
      roles: ['아이스크림 쏘기 🍦', '생존 (통과)']
    });
    assert.strictEqual(updateRes.success, true);
    assert.strictEqual(room.settings.roles[0], '아이스크림 쏘기 🍦');
    assert.strictEqual(updateRes.room.settings.roles[0], '아이스크림 쏘기 🍦');
  });
});
