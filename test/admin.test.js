const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const RoomManager = require('../server/models/RoomManager');
const config = require('../server/config');

describe('📊 관리자 실시간 모니터링 (Admin Stats & Control) 테스트', () => {
  let roomManager;

  before(() => {
    roomManager = new RoomManager();
  });

  after(() => {
    roomManager.stopGarbageCollector();
  });

  it('방 생성 시 hostIp와 상세 정보가 올바르게 기록되어야 한다', () => {
    const res = roomManager.createRoom('socket_test_1', '관리자테스터', { gameType: 'crocodile' }, '121.134.55.10');
    assert.strictEqual(res.success, true);

    const stats = roomManager.getStats();
    assert.strictEqual(stats.activeRooms, 1);
    assert.strictEqual(stats.maxRooms, 20);

    const roomStat = stats.rooms.find(r => r.id === res.room.id);
    assert.ok(roomStat, '생성된 방이 stats 목록에 존재해야 함');
    assert.strictEqual(roomStat.hostNickname, '관리자테스터');
    assert.strictEqual(roomStat.hostIp, '121.134.55.10');
    assert.strictEqual(roomStat.playerCount, 1);
    assert.strictEqual(roomStat.status, 'LOBBY');
    assert.strictEqual(roomStat.gameType, 'crocodile');
    assert.ok(roomStat.elapsedSec >= 0);
  });

  it('수동 GC (runManualGC) 실행 시 유휴 상태 방이 정상적으로 정리되어야 한다', () => {
    // 플레이어가 모두 접속 종료된 상태 시뮬레이션
    const room = Array.from(roomManager.rooms.values())[0];
    room.players.forEach(p => p.isConnected = false);

    const gcRes = roomManager.runManualGC();
    assert.ok(gcRes.cleaned >= 1, '접속자 없는 방이 정리되어야 함');
    assert.strictEqual(roomManager.rooms.size, 0);
  });

  it('관리자 API를 통한 방 강제 종료가 정상 작동해야 한다', () => {
    const res = roomManager.createRoom('socket_test_2', '폭파대상방장', {}, '127.0.0.1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(roomManager.rooms.size, 1);

    // 강제 소멸
    roomManager.destroyRoom(res.room.id, 'admin_force_destroy');
    assert.strictEqual(roomManager.rooms.size, 0);
    assert.strictEqual(roomManager.rooms.has(res.room.id), false);
  });
});
