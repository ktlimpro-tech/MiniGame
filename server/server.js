const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const config = require('./config');
const RoomManager = require('./models/RoomManager');

const app = express();
// Render.com 및 리버스 프록시 뒤에서 실제 클라이언트 IP 추출을 위해 필수 설정
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = config.PORT;
const roomManager = new RoomManager(io);

// 정적 파일 서빙 (public)
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// 클라이언트 실제 IP 추출 유틸리티 (Render 로드밸런서 프록시 헤더 완벽 지원)
function getClientIp(reqOrSocket) {
  const headers = reqOrSocket.headers || (reqOrSocket.handshake && reqOrSocket.handshake.headers) || {};
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return reqOrSocket.ip || (reqOrSocket.handshake && reqOrSocket.handshake.address) || '127.0.0.1';
}

// 1. Render.com 무중단 헬스체크 엔드포인트
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSec: Math.floor(process.uptime()),
    activeRooms: roomManager.rooms.size,
    maxRooms: roomManager.MAX_ROOMS,
    timestamp: Date.now()
  });
});

// 2. 관리자 통계 및 모니터링 API (보안 2중 검증: IP 화이트리스트 + 비밀번호)
app.get('/api/admin/stats', (req, res) => {
  const clientIp = getClientIp(req);
  const isWhitelisted = config.ADMIN_WHITELIST_IPS.includes(clientIp);

  // 비밀번호 검증 (헤더 x-admin-password 또는 쿼리 password)
  const reqPassword = req.headers['x-admin-password'] || req.query.password;
  const isPasswordValid = config.ADMIN_PASSWORD && reqPassword === config.ADMIN_PASSWORD;

  // IP 화이트리스트에 있거나, 유효한 관리자 비밀번호를 제공한 경우에만 접근 허용
  if (!isWhitelisted && !isPasswordValid) {
    console.warn(`[Security] 비인가 관리자 통계 접근 차단: IP=${clientIp}`);
    return res.status(403).json({
      error: '접근이 거부되었습니다. (관리자 권한 필요)',
      clientIp
    });
  }

  res.json({
    ...roomManager.getStats(),
    server: {
      uptimeSec: Math.floor(process.uptime()),
      memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      nodeEnv: config.NODE_ENV
    }
  });
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
  const clientIp = getClientIp(socket);

  // 1. NTP 서버 시각 동기화
  socket.on('syncTime', (clientSendTime, callback) => {
    if (typeof callback === 'function') {
      callback({
        clientSendTime,
        serverTime: Date.now()
      });
    }
  });

  // 2. 방 생성 (Rate Limiting 및 20개 상한 적용)
  socket.on('createRoom', ({ nickname, settings }, callback) => {
    const result = roomManager.createRoom(socket.id, nickname, settings, clientIp);
    if (result.success) {
      socket.join(result.room.id);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 3. 방 참가 (브루트포스 방어 적용)
  socket.on('joinRoom', ({ roomCode, nickname, token }, callback) => {
    const result = roomManager.joinRoom(socket.id, roomCode, nickname, token, clientIp);
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
  function attachCrocodileTimer(room) {
    if (!room || !room.activeGame || typeof room.activeGame.startTurnTimer !== 'function') return;
    room.activeGame.startTurnTimer(() => {
      const timeoutRes = room.activeGame.handleTimeout();
      if (timeoutRes && timeoutRes.broadcast) {
        broadcastToRoom(room.id, timeoutRes.eventName, timeoutRes.data);
        console.log(`[GameTimeout] Room(${room.id}) turn timed out! Loser: ${timeoutRes.data?.loser?.nickname}`);
      }
    });
  }

  socket.on('startGame', ({ roomCode, token }, callback) => {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = roomManager.rooms.get(code);
    const result = roomManager.startGame(roomCode, token);
    if (result.success) {
      if (room && room.activeGame) {
        attachCrocodileTimer(room);
      }
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

      if (room && room.activeGame) {
        if (result.eventName === 'toothPressed') {
          // 안전한 이빨 ➔ 다음 사람 타이머 시작
          attachCrocodileTimer(room);
        } else if (result.eventName === 'gameFinished') {
          // 게임 종료 ➔ 타이머 정지
          room.activeGame.clearTurnTimer();
        }
      }

      broadcastToRoom(result.roomId, result.eventName || 'gameUpdated', result.data);
      console.log(`[GameAction] Room(${result.roomId}) action: ${action}, event: ${result.eventName}, nextPlayer: ${result.data?.nextPlayer?.nickname || result.data?.loser?.nickname}`);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 8. 대기실로 리셋 (한 판 더!)
  socket.on('resetToLobby', ({ roomCode, token }, callback) => {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = roomManager.rooms.get(code);
    if (room && room.activeGame) room.activeGame.clearTurnTimer();

    const result = roomManager.resetToLobby(roomCode, token);
    if (result.success) {
      broadcastToRoom(result.room.id, 'roomUpdated', result.room);
    }
    if (typeof callback === 'function') callback(result);
  });

  // 9. 방 나가기
  socket.on('leaveRoom', ({ roomCode, token }, callback) => {
    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = roomManager.rooms.get(code);
    if (room && room.activeGame) room.activeGame.clearTurnTimer();

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

  // 10. 관전자 실시간 리액션 이모지/말풍선 전송 (서버 Rate Limiting 200ms 적용)
  const socketReactionRateMap = new Map();

  socket.on('sendReaction', ({ roomCode, token, emoji, text }) => {
    const now = Date.now();
    const lastSent = socketReactionRateMap.get(socket.id) || 0;
    if (now - lastSent < 200) {
      // 200ms 이내의 연타 요청은 서버에서 즉시 드랍하여 패킷 폭풍 차단
      return;
    }
    socketReactionRateMap.set(socket.id, now);

    const code = roomCode ? roomCode.toUpperCase() : '';
    const room = roomManager.rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.token === token);
    const nickname = player ? player.nickname : '익명';

    broadcastToRoom(room.id, 'reactionReceived', {
      senderToken: token,
      senderNickname: nickname,
      emoji: (emoji || '🐊').slice(0, 4),
      text: (text || '').slice(0, 15), // 악의적인 긴 텍스트 차단
      id: Math.random().toString(36).substring(2, 9),
      createdAt: now
    });
  });

  // 11. 연결 해제
  socket.on('disconnect', () => {
    socketReactionRateMap.delete(socket.id);
    const result = roomManager.handleDisconnect(socket.id);
    if (result && result.room) {
      broadcastToRoom(result.room.id, 'roomUpdated', result.room.toState());
    }
  });
});

server.listen(PORT, () => {
  console.log(`[MiniGame Hub] Server running on port ${PORT}`);
});
