const Room = require('./Room');

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomCode -> Room
    this.socketToRoom = new Map(); // socketId -> { roomCode, token }
    this.ipCreationTracker = new Map(); // ip -> [timestamp]
    this.ipWhitelist = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

    this.MAX_ROOMS = 20;
    this.GC_INTERVAL_MS = 30000; // 30초마다 검사
    this.LOBBY_TIMEOUT_MS = 5 * 60 * 1000; // 대기실 5분 방치 시 자동 폭파
    this.RESULT_TIMEOUT_MS = 10 * 60 * 1000; // 결과화면 10분 방치 시 자동 폭파
    this.EMERGENCY_TIMEOUT_MS = 30 * 60 * 1000; // 30분 무조작 시 비상 정리

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
      room,
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
        // 1. 대기실 5분 초과 방치 검사
        if (room.status === 'LOBBY' && now - (room.lobbyEnteredAt || room.createdAt) > this.LOBBY_TIMEOUT_MS) {
          this.destroyRoom(code, 'lobby_timeout');
          continue;
        }
        // 2. 결과 화면 10분 초과 방치 검사
        if (room.status === 'RESULT' && room.resultEnteredAt && now - room.resultEnteredAt > this.RESULT_TIMEOUT_MS) {
          this.destroyRoom(code, 'result_timeout');
          continue;
        }
        // 3. 비상 30분 무조작 검사
        if (now - room.lastActivityAt > this.EMERGENCY_TIMEOUT_MS) {
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
