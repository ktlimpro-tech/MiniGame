const Room = require('./Room');
const config = require('../config');

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomCode -> Room
    this.socketToRoom = new Map(); // socketId -> { roomCode, token }
    this.ipCreationTracker = new Map(); // ip -> [timestamp]
    this.ipFailedJoinTracker = new Map(); // ip -> [timestamp] (브루트포스 방어)

    this.ipWhitelist = new Set(config.ADMIN_WHITELIST_IPS);

    this.MAX_ROOMS = config.GAME.MAX_ROOMS;
    this.GC_INTERVAL_MS = config.GAME.GC_INTERVAL_MS;
    this.EMPTY_ROOM_TIMEOUT_MS = config.GAME.EMPTY_ROOM_TIMEOUT_MS;
    this.LOBBY_IDLE_TIMEOUT_MS = config.GAME.LOBBY_IDLE_TIMEOUT_MS;
    this.RESULT_IDLE_TIMEOUT_MS = config.GAME.RESULT_IDLE_TIMEOUT_MS;
    this.PLAYING_IDLE_TIMEOUT_MS = config.GAME.PLAYING_IDLE_TIMEOUT_MS;
    this.EMERGENCY_TIMEOUT_MS = config.GAME.EMERGENCY_TIMEOUT_MS;

    this.startGarbageCollector();
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O, 1/I 제외
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  checkRateLimit(ip) {
    if (this.ipWhitelist.has(ip)) return true;
    const now = Date.now();
    const timestamps = this.ipCreationTracker.get(ip) || [];
    const recent = timestamps.filter(t => now - t < config.RATE_LIMIT.WINDOW_MS);
    if (recent.length >= config.RATE_LIMIT.MAX_ROOMS_PER_IP) return false;
    recent.push(now);
    this.ipCreationTracker.set(ip, recent);
    return true;
  }

  checkFailedJoinLimit(ip) {
    if (this.ipWhitelist.has(ip)) return true;
    const now = Date.now();
    const timestamps = this.ipFailedJoinTracker.get(ip) || [];
    const recent = timestamps.filter(t => now - t < config.RATE_LIMIT.WINDOW_MS);
    if (recent.length >= config.RATE_LIMIT.MAX_FAILED_JOINS_PER_IP) return false;
    return true;
  }

  recordFailedJoin(ip) {
    if (!ip || this.ipWhitelist.has(ip)) return;
    const now = Date.now();
    const timestamps = this.ipFailedJoinTracker.get(ip) || [];
    const recent = timestamps.filter(t => now - t < config.RATE_LIMIT.WINDOW_MS);
    recent.push(now);
    this.ipFailedJoinTracker.set(ip, recent);
  }

  createRoom(socketId, hostNickname, settings = {}, clientIp = '') {
    // 1. 방 개설 개수 20개 절대 상한선 (21번째부터는 대기 및 차단)
    if (this.rooms.size >= this.MAX_ROOMS) {
      return {
        success: false,
        error: `현재 서버의 최대 활성 방(${this.MAX_ROOMS}개)이 가득 찼습니다. 잠시 후 다른 방이 종료되면 다시 시도해주세요.`
      };
    }

    // 2. 외부 해킹/스크립트 방 생성 폭탄 차단 (IP당 1분 최대 2개)
    if (!this.checkRateLimit(clientIp)) {
      return {
        success: false,
        error: '방 생성이 너무 빈번합니다. 보안을 위해 1분 후에 다시 시도해주세요.'
      };
    }

    const roomCode = this.generateRoomCode();
    const room = new Room(roomCode, hostNickname, socketId, settings);
    this.rooms.set(roomCode, room);

    const host = room.getHost();
    this.socketToRoom.set(socketId, { roomCode, token: host.token });

    console.log(`[RoomManager] 방 생성됨: ${roomCode} (현재 활성 방: ${this.rooms.size}/${this.MAX_ROOMS})`);

    return {
      success: true,
      room: room.toState(),
      token: host.token,
      isHost: true
    };
  }

  joinRoom(socketId, roomCode, nickname, token = null, clientIp = '') {
    // 3. 방 코드 무차별 대입(Brute-force) 공격 차단
    if (!this.checkFailedJoinLimit(clientIp)) {
      return {
        success: false,
        error: '존재하지 않는 방 코드를 너무 많이 입력했습니다. 보안을 위해 1분 후 다시 시도해주세요.'
      };
    }

    const code = roomCode ? roomCode.toUpperCase().trim() : '';
    const room = this.rooms.get(code);
    if (!room) {
      this.recordFailedJoin(clientIp);
      return { success: false, error: '존재하지 않는 방입니다. 코드를 다시 확인해주세요.' };
    }

    const result = room.addOrReconnectPlayer(socketId, nickname, token);
    if (result.success) {
      this.socketToRoom.set(socketId, { roomCode: room.id, token: result.player.token });
    }
    return result;
  }

  updateSettings(roomCode, token, settings) {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) return { success: false, error: '방을 찾을 수 없습니다.' };
    if (!room.isHost(token)) return { success: false, error: '방장만 설정을 변경할 수 있습니다.' };
    return room.updateSettings(settings);
  }

  startGame(roomCode, token) {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) return { success: false, error: '방을 찾을 수 없습니다.' };
    if (!room.isHost(token)) return { success: false, error: '방장만 게임을 시작할 수 있습니다.' };
    return room.startGame();
  }

  handleGameAction(roomCode, token, action, payload) {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) return { success: false, error: '방을 찾을 수 없습니다.' };
    return room.handleAction(token, action, payload);
  }

  resetToLobby(roomCode, token) {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) return { success: false, error: '방을 찾을 수 없습니다.' };
    if (!room.isHost(token)) return { success: false, error: '방장만 대기실로 리셋할 수 있습니다.' };
    return room.resetToLobby();
  }

  leaveRoom(socketId, roomCode, token) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: '방을 찾을 수 없습니다.' };

    const isHost = room.isHost(token);
    this.socketToRoom.delete(socketId);

    if (isHost) {
      // 방장이 나가면 방 완전 폭파
      this.destroyRoom(roomCode, 'host_left');
      return { success: true, roomDestroyed: true };
    } else {
      room.removePlayer(token);
      return { success: true, room, roomDestroyed: false };
    }
  }

  handleDisconnect(socketId) {
    const mapping = this.socketToRoom.get(socketId);
    if (!mapping) return null;

    const { roomCode, token } = mapping;
    this.socketToRoom.delete(socketId);

    const room = this.rooms.get(roomCode);
    if (room) {
      room.setPlayerConnected(token, false);
      return { room };
    }
    return null;
  }

  destroyRoom(roomCode, reason = 'unknown') {
    const room = this.rooms.get(roomCode);
    if (room) {
      room.destroy();
      this.rooms.delete(roomCode);

      // 소켓과 방의 매핑도 안전하게 정리 (메모리 완전 소멸 보장)
      for (const [socketId, mapping] of this.socketToRoom.entries()) {
        if (mapping && mapping.roomCode === roomCode) {
          this.socketToRoom.delete(socketId);
        }
      }

      if (this.io) {
        this.io.to(roomCode).emit('roomDestroyed', { reason });
      }
      console.log(`[GC] 방(${roomCode})이 완전히 소멸되었습니다. (사유: ${reason}) 현재 방 개수: ${this.rooms.size}/${this.MAX_ROOMS}`);
    }
  }

  startGarbageCollector() {
    this.gcTimer = setInterval(() => {
      const now = Date.now();
      for (const [code, room] of this.rooms.entries()) {
        const idleTime = now - room.lastActivityAt;
        const connectedCount = room.getConnectedPlayersCount();

        // 1. 모든 플레이어 연결 해제(0명) 상태에서 1분 경과 시 자동 폭파
        if (connectedCount === 0 && idleTime > this.EMPTY_ROOM_TIMEOUT_MS) {
          this.destroyRoom(code, 'all_players_disconnected');
          continue;
        }

        // 2. 대기실 유휴 5분 초과 검사 (마지막 조작/입장/설정변경 이후 5분간 아무것도 안 함)
        if (room.status === 'LOBBY' && idleTime > this.LOBBY_IDLE_TIMEOUT_MS) {
          this.destroyRoom(code, 'lobby_idle_timeout');
          continue;
        }

        // 3. 결과 화면 유휴 10분 초과 검사 (게임 종료 후 10분간 아무것도 안 하고 방치)
        if (room.status === 'RESULT' && idleTime > this.RESULT_IDLE_TIMEOUT_MS) {
          this.destroyRoom(code, 'result_idle_timeout');
          continue;
        }

        // 4. 인게임 유휴 5분 초과 검사 (게임 진행 중 이빨을 안 누르고 5분간 잠수)
        if (room.status === 'PLAYING' && idleTime > this.PLAYING_IDLE_TIMEOUT_MS) {
          this.destroyRoom(code, 'playing_idle_timeout');
          continue;
        }

        // 5. 비상 30분 무조작 검사
        if (idleTime > this.EMERGENCY_TIMEOUT_MS) {
          this.destroyRoom(code, 'emergency_timeout');
          continue;
        }
      }
    }, this.GC_INTERVAL_MS);

    // Node.js 이벤트 루프 블로킹 방지 (테스트 러너 및 정상 종료 지원)
    if (this.gcTimer && typeof this.gcTimer.unref === 'function') {
      this.gcTimer.unref();
    }
  }

  stopGarbageCollector() {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  getStats() {
    return {
      activeRooms: this.rooms.size,
      maxRooms: this.MAX_ROOMS,
      rooms: Array.from(this.rooms.values()).map(r => ({
        id: r.id,
        status: r.status,
        gameType: r.settings.gameType,
        players: r.players.length,
        createdAt: r.createdAt
      }))
    };
  }
}

module.exports = RoomManager;
