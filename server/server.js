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

// Socket.io 실시간 이벤트 라우팅
io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

  // 1. NTP 서버 시각 동기화 (PC/모바일 간 1초 오차 없는 타이머 보정)
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
      io.to(result.room.id).emit('roomUpdated', result.room.toState());
    }
    if (typeof callback === 'function') callback(result);
  });

  // 4. 대기실 설정 변경 (방장 전용: 게임 종류 선택, 내기 항목 등)
  socket.on('updateSettings', ({ roomCode, token, settings }, callback) => {
    const result = roomManager.updateSettings(roomCode, token, settings);
    if (result.success) {
      io.to(result.room.id).emit('roomUpdated', result.room.toState());
    }
    if (typeof callback === 'function') callback(result);
  });

  // 5. 게임 시작 (방장 전용)
  socket.on('startGame', ({ roomCode, token }, callback) => {
    const result = roomManager.startGame(roomCode, token);
    if (result.success) {
      io.to(result.room.id).emit('gameStarted', result.room.toState());
    }
    if (typeof callback === 'function') callback(result);
  });

  // 6. 개별 미니게임 인터랙션 (악어 이빨 누르기 등)
  socket.on('gameAction', ({ roomCode, token, action, payload }, callback) => {
    const result = roomManager.handleGameAction(roomCode, token, action, payload);
    if (result && result.broadcast) {
      // 소켓 방 조인 안전 보장
      socket.join(result.roomId);
      io.to(result.roomId).emit(result.eventName || 'gameUpdated', result.data);
      console.log(`[GameAction] Room(${result.roomId}) action: ${action}, event: ${result.eventName}, nextPlayer: ${result.data?.nextPlayer?.nickname || result.data?.loser?.nickname}`);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 7. 대기실로 리셋 (한 판 더!)
  socket.on('resetToLobby', ({ roomCode, token }, callback) => {
    const result = roomManager.resetToLobby(roomCode, token);
    if (result.success) {
      io.to(result.room.id).emit('roomUpdated', result.room.toState());
    }
    if (typeof callback === 'function') callback(result);
  });

  // 8. 방 나가기
  socket.on('leaveRoom', ({ roomCode, token }, callback) => {
    const result = roomManager.leaveRoom(socket.id, roomCode, token);
    if (result.success) {
      socket.leave(roomCode);
      if (result.roomDestroyed) {
        io.to(roomCode).emit('roomDestroyed', { reason: 'host_left' });
      } else if (result.room) {
        io.to(result.room.id).emit('roomUpdated', result.room.toState());
      }
    }
    if (typeof callback === 'function') callback(result);
  });

  // 9. 연결 해제
  socket.on('disconnect', () => {
    const result = roomManager.handleDisconnect(socket.id);
    if (result && result.room) {
      io.to(result.room.id).emit('roomUpdated', result.room.toState());
    }
  });
});

server.listen(PORT, () => {
  console.log(`[MiniGame Hub] Server running on port ${PORT}`);
});
