const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const RoomManager = require('./models/RoomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const roomManager = new RoomManager(io);

// 정적 파일 서빙 (public)
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// 헬스체크 API
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 관리자 통계 API
app.get('/api/admin/stats', (req, res) => {
  res.json(roomManager.getStats());
});

// 방에 속한 모든 플레이어에게 100% 안전하게 브로드캐스트하는 헬퍼 함수
function broadcastToRoom(roomId, eventName, data) {
  if (!roomId) return;
  const room = roomManager.rooms.get(roomId);

  // 1. 표준 소켓 룸 브로드캐스트
  io.to(roomId).emit(eventName, data);

  // 2. 혹시라도 룸 조인이 풀린 소켓이 있다면 개별 소켓으로도 2중 직접 전달 보장
  if (room && room.players) {
    for (const player of room.players) {
      if (player.socketId) {
        const s = io.sockets.sockets.get(player.socketId);
        if (s) {
          s.join(roomId); // 룸 조인 재확인
          s.emit(eventName, data);
        }
      }
    }
  }
}

// Socket.io 실시간 이벤트 라우팅
io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

  // 1. NTP 서버 시각 동기화
  socket.on('syncTime', (clientSendTime, callback) => {
    if (typeof callback === 'function') {
      callback({
        clientSendTime,
        serverTime: Date.now()
      });
    }
  });

  // 2. 방 생성 (Rate Limiting 적용)
  socket.on('createRoom', ({ nickname, settings }, callback) => {
    const result = roomManager.createRoom(socket.id, nickname, settings, clientIp);
    if (result.success) {
      socket.join(result.room.id);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 3. 방 참가
  socket.on('joinRoom', ({ roomCode, nickname, token }, callback) => {
    const result = roomManager.joinRoom(socket.id, roomCode, nickname, token);
    if (result.success) {
      socket.join(result.room.id);
      broadcastToRoom(result.room.id, 'roomUpdated', result.room);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 4. 소켓 재연결 시 룸 조인 복원 (Rejoin)
  socket.on('rejoinRoom', ({ roomCode, token }, callback) => {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = roomManager.rooms.get(code);
    if (room) {
      const p = room.players.find(pl => pl.token === token);
      if (p) {
        p.socketId = socket.id;
        p.isConnected = true;
        socket.join(room.id);
        roomManager.socketToRoom.set(socket.id, { roomCode: room.id, token: p.token });
        if (typeof callback === 'function') callback({ success: true, room: room.toState() });
        return;
      }
    }
    if (typeof callback === 'function') callback({ success: false });
  });

  // 5. 대기실 설정 변경 (방장 전용)
  socket.on('updateSettings', ({ roomCode, token, settings }, callback) => {
    const result = roomManager.updateSettings(roomCode, token, settings);
    if (result.success) {
      broadcastToRoom(result.room.id, 'roomUpdated', result.room);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 6. 게임 시작 (방장 전용)
  socket.on('startGame', ({ roomCode, token }, callback) => {
    const result = roomManager.startGame(roomCode, token);
    if (result.success) {
      broadcastToRoom(result.room.id, 'gameStarted', result.room);
      console.log(`[GameStart] Room(${result.room.id}) started! First turn: ${result.room.gameState?.currentTurnNickname}`);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 7. 개별 미니게임 인터랙션 (악어 이빨 누르기 등)
  socket.on('gameAction', ({ roomCode, token, action, payload }, callback) => {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = roomManager.rooms.get(code);

    // 요청 보낸 플레이어 소켓 ID 최신화
    if (room) {
      const player = room.players.find(p => p.token === token);
      if (player) {
        player.socketId = socket.id;
        player.isConnected = true;
      }
    }

    const result = roomManager.handleGameAction(code, token, action, payload);
    if (result && result.broadcast) {
      socket.join(result.roomId);
      broadcastToRoom(result.roomId, result.eventName || 'gameUpdated', result.data);
      console.log(`[GameAction] Room(${result.roomId}) action: ${action}, event: ${result.eventName}, nextPlayer: ${result.data?.nextPlayer?.nickname || result.data?.loser?.nickname}`);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 8. 대기실로 리셋 (한 판 더!)
  socket.on('resetToLobby', ({ roomCode, token }, callback) => {
    const result = roomManager.resetToLobby(roomCode, token);
    if (result.success) {
      broadcastToRoom(result.room.id, 'roomUpdated', result.room);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 9. 방 나가기
  socket.on('leaveRoom', ({ roomCode, token }, callback) => {
    const result = roomManager.leaveRoom(socket.id, roomCode, token);
    if (result.success) {
      socket.leave(roomCode);
      if (result.roomDestroyed) {
        io.to(roomCode).emit('roomDestroyed', { reason: 'host_left' });
      } else if (result.room) {
        broadcastToRoom(result.room.id, 'roomUpdated', result.room.toState());
      }
    }
    if (typeof callback === 'function') callback(result);
  });

  // 10. 연결 해제
  socket.on('disconnect', () => {
    const result = roomManager.handleDisconnect(socket.id);
    if (result && result.room) {
      broadcastToRoom(result.room.id, 'roomUpdated', result.room.toState());
    }
  });
});

server.listen(PORT, () => {
  console.log(`[MiniGame Hub] Server running on port ${PORT}`);
});
