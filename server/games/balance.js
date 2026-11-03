const path = require('path');
const fs = require('fs');

/**
 * 3호 게임: 이심전심 밸런스 게임 (BalanceGame)
 * - 2인 모드: [둘만의 이심전심] (3문제 중 2문제 이상 일치 시 성공)
 * - 3인 이상 모드: [소수파 독박 벌칙] (다수와 다른 소수파 플레이어가 벌칙 당첨!)
 */
class BalanceGame {
  constructor(room) {
    this.room = room;
    this.subMode = 'minority'; // 'couple', 'minority', 'consensus'
    this.questionsPool = [];
    this.usedQuestionIds = new Set();
    this.currentQuestion = null;
    this.round = 1;
    this.maxRounds = 3;
    this.matchCount = 0; // 2인 커플 모드에서 일치한 횟수
    this.votes = new Map(); // token -> 'A' | 'B'
    this.isRevealed = false;
    this.status = 'PLAYING'; // 'PLAYING', 'REVEALED', 'FINISHED'
    this.lastResult = null;

    this.loadQuestions();
  }

  loadQuestions() {
    try {
      const qPath = path.join(__dirname, '../data/telepathyQuestions.json');
      if (fs.existsSync(qPath)) {
        const raw = fs.readFileSync(qPath, 'utf8');
        this.questionsPool = JSON.parse(raw);
      }
    } catch (e) {
      console.error('[BalanceGame] Failed to load questions:', e);
      // 안전 폴백 기본 질문
      this.questionsPool = [
        { id: 1, category: "음식", question: "탕수육 먹을 때 나의 스타일은?", optionA: "바삭함 사수! 찍먹", optionB: "촉촉함 사수! 부먹" },
        { id: 2, category: "음식", question: "중국집 첫 주문의 영원한 고민?", optionA: "달콤 고소한 짜장면", optionB: "얼큰 칼칼한 짬뽕" }
      ];
    }
  }

  init() {
    const playerCount = this.room.players.length;

    // 1. 서브 모드 결정 (2인은 자동으로 'couple', 3인 이상은 방장 설정 또는 'minority')
    if (playerCount <= 2) {
      this.subMode = 'couple';
      this.maxRounds = 3; // 2인은 3판 2선승 느낌
    } else {
      const hostSubMode = this.room.settings && this.room.settings.balanceSubMode;
      this.subMode = hostSubMode === 'consensus' ? 'consensus' : 'minority';
      this.maxRounds = 1; // 3인 이상은 1라운드 단판 승부로 속도감 극대화
    }

    this.round = 1;
    this.matchCount = 0;
    this.status = 'PLAYING';
    this.lastResult = null;
    this.votes.clear();
    this.isRevealed = false;

    // 첫 번째 질문 뽑기
    this.pickNextQuestion();

    console.log(`[BalanceGame] Initialized for ${playerCount} players. Mode: ${this.subMode}, Question #${this.currentQuestion?.id}`);
  }

  pickNextQuestion() {
    this.votes.clear();
    this.isRevealed = false;

    // 사용 가능한 질문 필터링
    let available = this.questionsPool.filter(q => !this.usedQuestionIds.has(q.id));
    if (available.length === 0) {
      // 모든 질문을 다 썼으면 초기화 후 재셔플
      this.usedQuestionIds.clear();
      available = [...this.questionsPool];
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    this.currentQuestion = available[randomIndex];
    this.usedQuestionIds.add(this.currentQuestion.id);
  }

  handleAction(token, action, payload) {
    if (this.status === 'FINISHED') {
      return { success: false, error: '게임이 이미 종료되었습니다.' };
    }

    const player = this.room.players.find(p => p.token === token);
    if (!player) {
      return { success: false, error: '방에 속한 플레이어가 아닙니다.' };
    }

    if (action === 'vote') {
      const choice = payload && payload.option;
      if (choice !== 'A' && choice !== 'B') {
        return { success: false, error: 'A 또는 B를 선택해야 합니다.' };
      }

      // 투표 기록
      this.votes.set(token, choice);

      const votedCount = this.votes.size;
      const totalPlayers = this.room.players.length;

      // 1. 아직 전원 투표가 끝나지 않은 경우 ➔ 투표 진행률 알림 (선택지는 익명 유지)
      if (votedCount < totalPlayers) {
        return {
          success: true,
          broadcast: true,
          roomId: this.room.id,
          eventName: 'balanceVoteProgress',
          data: {
            votedCount,
            totalPlayers,
            room: this.room.toState()
          }
        };
      }

      // 2. 전원 투표 완료 ➔ 결과 집계 및 동시 개봉!
      this.isRevealed = true;
      return this.evaluateRound();
    }

    if (action === 'nextRound') {
      // 2인 커플 모드에서 다음 문제로 진행
      if (this.subMode === 'couple' && this.round < this.maxRounds) {
        this.round++;
        this.pickNextQuestion();
        return {
          success: true,
          broadcast: true,
          roomId: this.room.id,
          eventName: 'balanceNextQuestion',
          data: {
            round: this.round,
            maxRounds: this.maxRounds,
            question: this.currentQuestion,
            room: this.room.toState()
          }
        };
      }
    }

    return { success: false, error: '유효하지 않은 동작입니다.' };
  }

  evaluateRound() {
    const votesA = [];
    const votesB = [];

    for (const player of this.room.players) {
      const choice = this.votes.get(player.token);
      if (choice === 'A') {
        votesA.push({ token: player.token, nickname: player.nickname });
      } else {
        votesB.push({ token: player.token, nickname: player.nickname });
      }
    }

    // ============================================
    // 모드 1: [2인 전용 둘만의 이심전심]
    // ============================================
    if (this.subMode === 'couple') {
      const isMatched = (votesA.length === 2 || votesB.length === 2);
      if (isMatched) this.matchCount++;

      this.lastResult = {
        subMode: 'couple',
        round: this.round,
        maxRounds: this.maxRounds,
        question: this.currentQuestion,
        votesA,
        votesB,
        isMatched,
        matchCount: this.matchCount
      };

      // 마지막 3라운드까지 끝났는지 확인
      if (this.round >= this.maxRounds) {
        this.status = 'FINISHED';
        const isSuccess = this.matchCount >= 2; // 3문제 중 2문제 이상 일치 시 성공!
        const results = this.room.players.map(p => ({
          token: p.token,
          nickname: p.nickname,
          isLoser: !isSuccess,
          role: isSuccess ? '찰떡궁합! 전원 생존' : '불일치 벌칙 당첨'
        }));
        this.room.finishGame(results);

        return {
          success: true,
          broadcast: true,
          roomId: this.room.id,
          eventName: 'balanceFinished',
          data: {
            subMode: 'couple',
            isSuccess,
            matchCount: this.matchCount,
            maxRounds: this.maxRounds,
            lastResult: this.lastResult,
            loser: isSuccess ? null : { nickname: '두 사람 모두' },
            room: this.room.toState()
          }
        };
      }

      // 다음 라운드 대기 상태
      return {
        success: true,
        broadcast: true,
        roomId: this.room.id,
        eventName: 'balanceRoundRevealed',
        data: {
          subMode: 'couple',
          round: this.round,
          maxRounds: this.maxRounds,
          result: this.lastResult,
          room: this.room.toState()
        }
      };
    }

    // ============================================
    // 모드 2: [3인 이상 소수파 독박 벌칙] (기본)
    // ============================================
    const isUnanimous = votesA.length === 0 || votesB.length === 0;
    let minorityVotes = [];
    let majorityVotes = [];
    let isDraw = votesA.length === votesB.length;

    if (!isDraw && !isUnanimous) {
      if (votesA.length < votesB.length) {
        minorityVotes = votesA;
        majorityVotes = votesB;
      } else {
        minorityVotes = votesB;
        majorityVotes = votesA;
      }
    }

    this.lastResult = {
      subMode: 'minority',
      question: this.currentQuestion,
      votesA,
      votesB,
      isUnanimous,
      isDraw,
      minorityVotes,
      majorityVotes
    };

    this.status = 'FINISHED';

    if (isUnanimous) {
      // 전원 만장일치 일치 ➔ 전원 승리 & 보너스!
      const results = this.room.players.map(p => ({
        token: p.token,
        nickname: p.nickname,
        isLoser: false,
        role: '만장일치 대성공! 벌칙 면제'
      }));
      this.room.finishGame(results);

      return {
        success: true,
        broadcast: true,
        roomId: this.room.id,
        eventName: 'balanceFinished',
        data: {
          subMode: 'minority',
          isSuccess: true,
          isUnanimous: true,
          isDraw: false,
          lastResult: this.lastResult,
          loser: null,
          room: this.room.toState()
        }
      };
    }

    if (isDraw) {
      // 2:2 등 동률 ➔ 무승부! (전원 생존 또는 재대결)
      const results = this.room.players.map(p => ({
        token: p.token,
        nickname: p.nickname,
        isLoser: false,
        role: '황금 밸런스 동률 (무승부)'
      }));
      this.room.finishGame(results);

      return {
        success: true,
        broadcast: true,
        roomId: this.room.id,
        eventName: 'balanceFinished',
        data: {
          subMode: 'minority',
          isSuccess: false,
          isUnanimous: false,
          isDraw: true,
          lastResult: this.lastResult,
          loser: { nickname: '황금 동률 (무승부)' },
          room: this.room.toState()
        }
      };
    }

    // 소수파 벌칙 확정!
    const results = this.room.players.map(p => {
      const isMinority = minorityVotes.some(m => m.token === p.token);
      return {
        token: p.token,
        nickname: p.nickname,
        isLoser: isMinority,
        role: isMinority ? '소수파 벌칙 당첨' : '다수파 생존'
      };
    });
    this.room.finishGame(results);

    const loserNickname = minorityVotes.map(m => m.nickname).join(', ');

    return {
      success: true,
      broadcast: true,
      roomId: this.room.id,
      eventName: 'balanceFinished',
      data: {
        subMode: 'minority',
        isSuccess: false,
        isUnanimous: false,
        isDraw: false,
        lastResult: this.lastResult,
        loser: { nickname: loserNickname },
        minorityCount: minorityVotes.length,
        room: this.room.toState()
      }
    };
  }

  // 타이머 인터페이스 호환용
  clearTurnTimer() {}
  startTurnTimer() {}

  destroy() {
    this.votes.clear();
  }

  toState(targetToken = null) {
    const playersState = this.room.players.map(p => {
      const choice = this.votes.get(p.token);
      const isMe = targetToken && p.token === targetToken;
      return {
        token: p.token,
        nickname: p.nickname,
        hasVoted: this.votes.has(p.token),
        // 결과가 공개되었거나(isRevealed), 본인인 경우에만 선택지 노출
        choice: (this.isRevealed || isMe) ? choice : null
      };
    });

    const myVote = targetToken ? this.votes.get(targetToken) || null : null;

    return {
      gameType: 'balance',
      subMode: this.subMode,
      round: this.round,
      maxRounds: this.maxRounds,
      matchCount: this.matchCount,
      currentQuestion: this.currentQuestion,
      isRevealed: this.isRevealed,
      status: this.status,
      votedCount: this.votes.size,
      totalPlayers: this.room.players.length,
      myVote,
      lastResult: this.isRevealed ? this.lastResult : null,
      players: playersState
    };
  }
}

module.exports = BalanceGame;
