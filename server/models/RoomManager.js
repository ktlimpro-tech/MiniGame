const Room = require('./Room');

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomCode -> Room
    this.socketToRoom = new Map(); // socketId -> { roomCode, token }
    this.ipCreationTracker = new Map(); // ip -> [timestamp]
    this.ipWhitelist = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

    this.MAX_ROOMS = 20;
    this.GC_INTERVAL_MS = 15000; // 15초마다 유휴 검사
    this.EMPTY_ROOM_TIMEOUT_MS = 60 * 1000; // 전원 이탈 시 1분 유예 후 폭파
    this.LOBBY_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 대기실 마지막 활동 후 5분 유휴 시 폭파
    this.RESULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 결과 화면 종료 후 10분 유휴 시 폭파
    this.PLAYING_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 인게임 잠수 5분 유휴 시 폭파
    this.EMERGENCY_TIMEOUT_MS = 30 * 60 * 1000; // 비상 30분 무조작 시 폭파

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
    const recent = timestamps.filter(t => now - t < 60000);
    if (recent.length >= 2) return false;
    recent.push(now);
    this.ipCreationTracker.set(ip, recent);
    return true;
  }

  createRoom(socketId, hostNickname, settings = {}, clientIp = '') {
    if (this.rooms.size >= this.MAX_ROOMS) {
      return { success: false, error: '서버 수용 한도(20개 방)를 초과했습니다. 잠시 후 다시 시도해주세요.' };
    }
    if (!this.checkRateLimit(clientIp)) {
      return { success: false, error: '방 생성이 너무 빈번합니다. 1분 후에 다시 시도해주세요.' };
    }

    const roomCode = this.generateRoomCode();
    const room = new Room(roomCode, hostNickname, socketId, settings);
    this.rooms.set(roomCode, room);

    const host = room.getHost();
    this.socketToRoom.set(socketId, { roomCode, token: host.token });

    return {
      success: true,
      room: room.toState(),
      token: host.token,
      isHost: true
    };
  }

  joinRoom(socketId, roomCode, nickname, token = null) {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) {
      return { success: false, error: '존재하지 않는 방입니다.' };
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
      if (this.io) {
        this.io.to(roomCode).emit('roomDestroyed', { reason });
      }
      console.log(`[GC] 방(${roomCode})이 완전히 소멸되었습니다. (사유: ${reason})`);
    }
  }

  startGarbageCollector() {
    setInterval(() => {
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
