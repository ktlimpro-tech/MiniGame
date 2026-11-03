const crypto = require('crypto');
const CrocodileGame = require('../games/crocodile');
const TelepathyGame = require('../games/telepathy');
const BalanceGame = require('../games/balance');

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
      gameType: customSettings.gameType || 'crocodile', // 'crocodile' (1호), 'telepathy' (2호), 'balance' (3호)
      cardsPerPlayer: customSettings.cardsPerPlayer || 2, // 2호 텔레파시 인당 카드 수
      balanceSubMode: customSettings.balanceSubMode || 'minority', // 3호 밸런스 모드 ('minority', 'couple', 'consensus')
      roles: customSettings.roles || ['당첨 (벌칙)', '생존 (통과)'], // 내기 항목
      turnTimeoutSec: customSettings.turnTimeoutSec || 10,
      ...customSettings
    };

    // 활성 미니게임 인스턴스 (현재는 1호 악어 이빨)
    this.activeGame = null;

    // 방장 등록
    const hostToken = crypto.randomUUID();
    const cleanHostNick = (hostNickname || '').trim() || '방장';
    this.players.push({
      token: hostToken,
      socketId: hostSocketId,
      nickname: cleanHostNick,
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

  generateUniqueNickname(desiredNickname, excludeToken = null) {
    const raw = (desiredNickname || '').trim() || `참가자${this.players.length + 1}`;
    const base = raw.replace(/\(\d+\)$/, '').trim() || '참가자';

    // 본인(재연결 시)을 제외한 다른 플레이어 닉네임 목록 (대소문자 무시 비교)
    const otherPlayers = this.players.filter(p => !excludeToken || p.token !== excludeToken);
    const existingLowerNames = new Set(otherPlayers.map(p => p.nickname.toLowerCase()));

    if (!existingLowerNames.has(raw.toLowerCase())) {
      return raw;
    }

    let counter = 2;
    while (existingLowerNames.has(`${base}(${counter})`.toLowerCase())) {
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
        if (nickname && nickname.trim() !== existing.nickname) {
          existing.nickname = this.generateUniqueNickname(nickname, existing.token);
        }
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
    } else if (this.settings.gameType === 'telepathy') {
      this.activeGame = new TelepathyGame(this);
      this.activeGame.init();
    } else if (this.settings.gameType === 'balance') {
      this.activeGame = new BalanceGame(this);
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
    if (this.activeGame && typeof this.activeGame.destroy === 'function') {
      try {
        this.activeGame.destroy();
      } catch (e) {
        console.warn('[Room] Error destroying activeGame on resetToLobby:', e);
      }
    }
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

  toState(targetToken = null) {
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
      gameState: this.activeGame ? this.activeGame.toState(targetToken) : null,
      gameResults: this.gameResults || null
    };
  }
}

module.exports = Room;
