/**
 * MiniGame Hub - 검증된 소켓 통신 & NTP 정밀 시간 동기화 매니저
 */
class SocketManager {
  constructor() {
    this.socket = null;
    this.serverTimeOffset = 0; // 서버와의 밀리초 시각 차이
    this.isSynced = false;
  }

  connect() {
    if (this.socket) return this.socket;

    this.socket = io({
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected! id:', this.socket.id);
      this.syncServerTime();
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
    });

    return this.socket;
  }

  // NTP 방식 정밀 시간 동기화 (왕복 지연시간 보정)
  syncServerTime(callback) {
    if (!this.socket) return;
    const t0 = Date.now();

    this.socket.emit('syncTime', t0, (res) => {
      if (res && res.serverTime) {
        const t3 = Date.now();
        const rtt = t3 - res.clientSendTime;
        const latency = rtt / 2;
        this.serverTimeOffset = res.serverTime + latency - t3;
        this.isSynced = true;
        console.log(`[NTP Sync] Offset: ${this.serverTimeOffset.toFixed(1)}ms (RTT: ${rtt}ms)`);
        if (callback) callback(this.serverTimeOffset);
      }
    });
  }

  getSyncedNow() {
    return Date.now() + this.serverTimeOffset;
  }

  createRoom(nickname, settings, callback) {
    this.socket.emit('createRoom', { nickname, settings }, callback);
  }

  joinRoom(roomCode, nickname, token, callback) {
    this.socket.emit('joinRoom', { roomCode, nickname, token }, callback);
  }

  updateSettings(roomCode, token, settings, callback) {
    this.socket.emit('updateSettings', { roomCode, token, settings }, callback);
  }

  startGame(roomCode, token, callback) {
    this.socket.emit('startGame', { roomCode, token }, callback);
  }

  sendGameAction(roomCode, token, action, payload, callback) {
    this.socket.emit('gameAction', { roomCode, token, action, payload }, callback);
  }

  resetToLobby(roomCode, token, callback) {
    this.socket.emit('resetToLobby', { roomCode, token }, callback);
  }

  leaveRoom(roomCode, token, callback) {
    this.socket.emit('leaveRoom', { roomCode, token }, callback);
  }
}

window.socketManager = new SocketManager();
