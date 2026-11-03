const crypto = require('crypto');
const CrocodileGame = require('../games/crocodile');

class Room {
  constructor(roomCode, hostNickname, hostSocketId, customSettings = {}) {
    this.id = roomCode;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
    this.lobbyEnteredAt = Date.now();
    this.resultEnteredAt = null;

    this.status = 'LOBBY'; // LOBBY, PLAYING, RESULT
    this.players = [];

    // 공통 허브 설정
    this.settings = {
      gameType: customSettings.gameType || 'crocodile', // 'crocodile' (1호), 'nunchi' (2호), 'liar' (3호)
      roles: customSettings.roles || ['당첨 (벌칙)', '생존 (통과)'], // 내기 항목
      turnTimeoutSec: customSettings.turnTimeoutSec || 10,
      ...customSettings
    };

    // 활성 미니게임 인스턴스 (현재는 1호 악어 이빨)
    this.activeGame = null;

    // 방장 등록
    const hostToken = crypto.randomUUID();
    this.players.push({
      token: hostToken,
      socketId: hostSocketId,
      nickname: hostNickname || '방장',
      isHost: true,
      isConnected: true,
      joinedAt: Date.now()
    });
  }

  touch() {
    this.lastActivityAt = Date.now();
  }

  isHost(token) {
    const p = this.players.find(pl => pl.token === token);
    return !!(p && p.isHost);
  }

  getHost() {
    return this.players.find(p => p.isHost);
  }

  getConnectedPlayersCount() {
    return this.players.filter(p => p.isConnected).length;
  }

  generateUniqueNickname(desiredNickname) {
    const raw = (desiredNickname || '').trim() || `참가자${this.players.length + 1}`;
    const base = raw.replace(/\(\d+\)$/, '').trim();
    const existingNames = new Set(this.players.map(p => p.nickname));
    if (!existingNames.has(raw)) {
      return raw;
    }
    let counter = 2;
    while (existingNames.has(`${base}(${counter})`)) {
      counter++;
    }
    return `${base}(${counter})`;
  }

  addOrReconnectPlayer(socketId, nickname, token = null) {
    this.touch();
    if (token) {
      const existing = this.players.find(p => p.token === token);
      if (existing) {
        existing.socketId = socketId;
        existing.isConnected = true;
        if (nickname) existing.nickname = nickname;
        return { success: true, player: existing, room: this.toState(), isReconnect: true };
      }
    }

    if (this.status !== 'LOBBY') {
      return { success: false, error: '게임이 이미 시작되어 참여할 수 없습니다.' };
    }
    if (this.players.length >= 10) {
      return { success: false, error: '방 최대 인원(10명)이 가득 찼습니다.' };
    }

    const uniqueNickname = this.generateUniqueNickname(nickname);
    const newToken = crypto.randomUUID();
    const newPlayer = {
      token: newToken,
      socketId,
      nickname: uniqueNickname,
      isHost: false,
      isConnected: true,
      joinedAt: Date.now()
    };
    this.players.push(newPlayer);
    return { success: true, player: newPlayer, room: this.toState(), isReconnect: false };
  }

  removePlayer(token) {
    this.touch();
    this.players = this.players.filter(p => p.token !== token);
  }

  setPlayerConnected(token, isConnected) {
    const p = this.players.find(pl => pl.token === token);
    if (p) p.isConnected = isConnected;
  }

  updateSettings(newSettings) {
    this.touch();
    this.settings = { ...this.settings, ...newSettings };
    return { success: true, room: this.toState() };
  }

  startGame() {
    this.touch();
    if (this.players.length < 2) {
      return { success: false, error: '최소 2명 이상 모여야 게임을 시작할 수 있습니다.' };
    }

    this.status = 'PLAYING';
    this.lobbyEnteredAt = null;

    // 게임 타입에 따른 게임 인스턴스 생성
    if (this.settings.gameType === 'crocodile') {
      this.activeGame = new CrocodileGame(this);
      this.activeGame.init();
    }

    return { success: true, room: this.toState() };
  }

  handleAction(token, action, payload) {
    this.touch();
    if (this.status !== 'PLAYING' || !this.activeGame) {
      return { success: false, error: '현재 진행 중인 게임이 없습니다.' };
    }
    return this.activeGame.handleAction(token, action, payload);
  }

  finishGame(results) {
    this.touch();
    this.status = 'RESULT';
    this.resultEnteredAt = Date.now();
    this.gameResults = results;
  }

  resetToLobby() {
    this.touch();
    this.status = 'LOBBY';
    this.lobbyEnteredAt = Date.now();
    this.resultEnteredAt = null;
    this.activeGame = null;
    this.gameResults = null;
    return { success: true, room: this.toState() };
  }

  destroy() {
    if (this.activeGame && typeof this.activeGame.destroy === 'function') {
      this.activeGame.destroy();
    }
    this.players = [];
    this.activeGame = null;
  }

  toState() {
    return {
      id: this.id,
      status: this.status,
      settings: this.settings,
      players: this.players.map(p => ({
        token: p.token,
        nickname: p.nickname,
        isHost: p.isHost,
        isConnected: p.isConnected
      })),
      gameState: this.activeGame ? this.activeGame.toState() : null,
      gameResults: this.gameResults || null
    };
  }
}

module.exports = Room;
