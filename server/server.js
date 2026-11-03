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

// 2. 관리자 웹 대시보드 페이지 라우트
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// 관리자 인증 미들웨어 헬퍼 함수
function checkAdminAuth(req, res, next) {
  const clientIp = getClientIp(req);
  const isWhitelisted = config.ADMIN_WHITELIST_IPS.includes(clientIp);
  const reqPassword = req.headers['x-admin-password'] || req.query.password;
  const isPasswordValid = config.ADMIN_PASSWORD && reqPassword === config.ADMIN_PASSWORD;

  if (!isWhitelisted && !isPasswordValid) {
    console.warn(`[Security] 비인가 관리자 API 접근 차단: IP=${clientIp}, Path=${req.path}`);
    return res.status(403).json({
      success: false,
      error: '접근이 거부되었습니다. 관리자 권한이 필요합니다.',
      clientIp,
      requiresPassword: true
    });
  }
  next();
}

// 3. 관리자 실시간 모니터링 통계 API
app.get('/api/admin/stats', checkAdminAuth, (req, res) => {
  const clientIp = getClientIp(req);
  const uptimeSec = Math.floor(process.uptime());
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const seconds = uptimeSec % 60;
  const uptimeFormatted = `${days > 0 ? days + '일 ' : ''}${hours}시간 ${minutes}분 ${seconds}초`;

  const memoryUsageMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const memoryMaxMB = 512; // Render.com 기본 스타터 인스턴스 RAM 한도
  const memoryRatio = Math.min(100, Math.round((memoryUsageMB / memoryMaxMB) * 100));

  res.json({
    success: true,
    ...roomManager.getStats(),
    connectedSockets: io.engine ? io.engine.clientsCount : (io.sockets.sockets.size || 0),
    server: {
      uptimeSec,
      uptimeFormatted,
      memoryUsageMB,
      memoryMaxMB,
      memoryRatio,
      nodeEnv: config.NODE_ENV,
      nodeVersion: process.version,
      clientIp
    }
  });
});

// 4. 관리자 특정 방 강제 폭파(소멸) API
app.delete('/api/admin/rooms/:id', checkAdminAuth, (req, res) => {
  const roomCode = req.params.id ? req.params.id.toUpperCase() : '';
  const room = roomManager.rooms.get(roomCode);
  if (!room) {
    return res.status(404).json({ success: false, error: '해당 방을 찾을 수 없습니다.' });
  }

  // 방에 있는 플레이어들에게 방 해산 알림 통지
  broadcastToRoom(roomCode, 'roomDestroyed', { reason: '관리자에 의해 방이 종료되었습니다.' });

  // 소멸 처리
  roomManager.destroyRoom(roomCode, 'admin_force_destroy');
  console.log(`[Admin] 방(${roomCode})이 관리자에 의해 강제 소멸되었습니다.`);

  res.json({
    success: true,
    message: `방(${roomCode})이 성공적으로 강제 소멸되었습니다.`,
    remainingRooms: roomManager.rooms.size
  });
});

// 5. 관리자 수동 인메모리 GC(가비지 컬렉터) 즉시 실행 API
app.post('/api/admin/gc', checkAdminAuth, (req, res) => {
  const result = roomManager.runManualGC();
  console.log(`[Admin] 수동 GC 실행 완료: 정리된 방 ${result.cleaned}개, 남은 방 ${result.remaining}개`);
  res.json({
    success: true,
    message: `수동 GC 완료: 유휴 방 ${result.cleaned}개가 정리되었습니다.`,
    ...result
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
    if (result.success && room) {
      if (room.activeGame) {
        attachCrocodileTimer(room);
      }
      const freshRoom = room.toState();
      broadcastToRoom(freshRoom.id, 'gameStarted', freshRoom);
      console.log(`[GameStart] Room(${freshRoom.id}) started! First turn: ${freshRoom.gameState?.currentTurnNickname}, expires: ${freshRoom.gameState?.turnExpiresAt}`);
      if (typeof callback === 'function') callback({ success: true, room: freshRoom });
      return;
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
          // 타이머가 새로 세팅된 최신 룸 상태로 data.room 갱신 (클라이언트에 이전 턴 잔여시간 전달 방지)
          result.data.room = room.toState();
        } else if (result.eventName === 'gameFinished') {
          // 게임 종료 ➔ 타이머 정지
          room.activeGame.clearTurnTimer();
          result.data.room = room.toState();
        }
      }

      broadcastToRoom(result.roomId, result.eventName || 'gameUpdated', result.data);
      console.log(`[GameAction] Room(${result.roomId}) action: ${action}, event: ${result.eventName}, nextPlayer: ${result.data?.nextPlayer?.nickname || result.data?.loser?.nickname}, expires: ${result.data?.room?.gameState?.turnExpiresAt}`);
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
