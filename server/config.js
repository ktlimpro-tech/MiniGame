const fs = require('fs');
const path = require('path');

// 1. 보안 환경변수 로더: 로컬 .env 파일이 있으면 안전하게 로드 (.gitignore로 Git 커밋 차단)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...vals] = trimmed.split('=');
      if (key && !process.env[key.trim()]) {
        process.env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {
    console.warn('[Config] .env 로드 중 오류 무시:', e.message);
  }
}

/**
 * 2026 MiniGame Hub 환경 설정 및 서버 리소스 한계 관리
 */
module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // 게임 기본 규칙 및 서버 자원 보호 설정
  GAME: {
    MAX_ROOMS: parseInt(process.env.MAX_ROOMS, 10) || 20, // 서버 전체 동시 방 개수 절대 상한선 (하드 리밋)
    ROOM_CODE_LENGTH: 4,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 10,

    // 인메모리 GC 유휴 방 자동 소멸(수명주기) 설정
    GC_INTERVAL_MS: 15 * 1000, // 15초마다 검사
    EMPTY_ROOM_TIMEOUT_MS: 60 * 1000, // 전원 이탈 시 1분 유예 후 폭파
    LOBBY_IDLE_TIMEOUT_MS: 5 * 60 * 1000, // 대기실 유휴 5분
    RESULT_IDLE_TIMEOUT_MS: 10 * 60 * 1000, // 결과 화면 유휴 10분
    PLAYING_IDLE_TIMEOUT_MS: 5 * 60 * 1000, // 인게임 잠수 유휴 5분
    EMERGENCY_TIMEOUT_MS: 30 * 60 * 1000, // 비상 30분 무조작 시 폭파
  },

  // 외부 해킹 및 무차별 공격 차단 (Rate Limiting)
  RATE_LIMIT: {
    WINDOW_MS: 60 * 1000, // 1분
    MAX_ROOMS_PER_IP: 2, // 1분당 IP별 최대 방 개설 2개 허용
    MAX_FAILED_JOINS_PER_IP: 5, // 1분당 존재하지 않는 방 코드 연속 실패 5회 초과 시 1분 차단
  },

  // 관리자 IP 화이트리스트 (로컬 루프백 기본 허용 + Render/환경변수 ADMIN_IPS 지정)
  ADMIN_WHITELIST_IPS: [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    ...(process.env.ADMIN_IPS
      ? process.env.ADMIN_IPS.split(',').map((ip) => ip.trim())
      : []),
  ],

  // 관리자 모니터링 API 인증 비밀번호 (.env 또는 Render Environment Variables 주입)
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || null,
};
