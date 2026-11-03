/**
 * MiniGame Hub - 검증된 소켓 통신 & NTP 정밀 시간 동기화 매니저
 */
class SocketManager {
  constructor() {
    this.socket = null;
    // 이전 세션에서 저장된 시간 오프셋이 있으면 초기값으로 복원 (새로고침 시 0ms 튀는 현상 원천 방지)
    const cachedOffset = parseFloat(sessionStorage.getItem('minigame_time_offset') || '0');
    this.serverTimeOffset = isNaN(cachedOffset) ? 0 : cachedOffset;
    this.isSynced = !isNaN(cachedOffset) && cachedOffset !== 0;
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

  // 온라인 멀티플레이어 표준 NTP (SNTP) 정밀 시간 동기화 (3회 측정 후 최소 RTT 샘플 채택)
  syncServerTime(callback) {
    if (!this.socket) return;

    const samples = [];
    const maxSamples = 3;

    const takeSample = (index) => {
      const t0 = Date.now();
      this.socket.emit('syncTime', t0, (res) => {
        if (res && res.serverTime) {
          const t3 = Date.now();
          const rtt = t3 - res.clientSendTime;
          const latency = rtt / 2;
          const offset = res.serverTime + latency - t3;
          samples.push({ rtt, offset });

          // 첫 번째 샘플 도착 즉시 1차 오프셋으로 반영하여 초기 160ms 지연 시간 해소
          if (index === 0 && !this.isSynced) {
            this.serverTimeOffset = offset;
          }
        }

        if (index < maxSamples - 1) {
          setTimeout(() => takeSample(index + 1), 60);
        } else if (samples.length > 0) {
          // 지터(네트워크 튐) 배제를 위해 RTT(왕복 지연시간)가 가장 작은 최적 샘플 채택
          samples.sort((a, b) => a.rtt - b.rtt);
          const best = samples[0];
          this.serverTimeOffset = best.offset;
          this.isSynced = true;
          try {
            sessionStorage.setItem('minigame_time_offset', String(this.serverTimeOffset));
          } catch (e) {}
          console.log(`[NTP Sync Complete] 정밀 오프셋 확정: ${this.serverTimeOffset.toFixed(1)}ms (최소 RTT: ${best.rtt}ms)`);
          if (callback) callback(this.serverTimeOffset);
        }
      });
    };

    takeSample(0);
  }

  getSyncedNow() {
    return Date.now() + this.serverTimeOffset;
  }

  createRoom(nickname, settings, callback) {
    this.socket.emit('createRoom', { nickname, settings }, callback);
  }

  rejoinRoom(roomCode, token, callback) {
    if (!this.socket) return;
    this.socket.emit('rejoinRoom', { roomCode, token }, callback);
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
