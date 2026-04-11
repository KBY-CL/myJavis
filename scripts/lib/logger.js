/**
 * 구조화 로깅 모듈
 * 타임스탬프(KST)와 로그 레벨을 포함한 stdout 출력 + 파일 append 기능 제공
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 프로젝트 루트 기준으로 logs/ 디렉토리 경로 결정
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const LOGS_DIR = path.join(ROOT, 'logs');

// 로그 레벨 우선순위 맵
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * 설정된 로그 레벨 반환 (기본: info)
 * @returns {number}
 */
function getMinLevel() {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

/**
 * KST 기준 현재 타임스탬프 문자열 반환
 * @returns {string} - '2026-04-11 08:01:23+09:00' 형식
 */
function getTimestamp() {
  const now = new Date();
  // Intl.DateTimeFormat으로 KST 변환 (moment/dayjs 금지)
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  // sv-SE 로케일은 'YYYY-MM-DD HH:mm:ss' 형식을 반환
  const parts = formatter.format(now);
  return `${parts}+09:00`;
}

/**
 * KST 기준 오늘 날짜 문자열 반환
 * @returns {string} - 'YYYY-MM-DD'
 */
function getKstDate() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * logs/ 디렉토리가 없으면 생성
 */
function ensureLogsDir() {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  } catch {
    // 디렉토리 생성 실패 시 파일 로깅은 무시 (stdout만 출력)
  }
}

/**
 * 로그 파일에 append
 * @param {string} scope
 * @param {string} line
 */
function appendToFile(scope, line) {
  try {
    ensureLogsDir();
    const date = getKstDate();
    const logPath = path.join(LOGS_DIR, `${scope}-${date}.log`);
    fs.appendFileSync(logPath, line + '\n', 'utf-8');
  } catch {
    // 파일 쓰기 실패는 조용히 무시
  }
}

/**
 * 로그 출력 핵심 함수
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} scope
 * @param {string} message
 * @param {*} [meta]
 */
function log(level, scope, message, meta) {
  // 설정된 레벨 미만이면 출력하지 않음
  if ((LEVELS[level] ?? 0) < getMinLevel()) return;

  const ts = getTimestamp();
  const levelStr = level.toUpperCase().padEnd(5);
  let line = `[${ts}] [${levelStr}] [${scope}] ${message}`;

  if (meta !== undefined) {
    try {
      const metaStr = typeof meta === 'object' ? JSON.stringify(meta) : String(meta);
      line += ` ${metaStr}`;
    } catch {
      line += ' [meta serialize error]';
    }
  }

  // stdout 출력 (error 레벨은 stderr)
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }

  // 파일 append
  appendToFile(scope, line);
}

/**
 * 구조화 로거 객체
 * 사용 예: logger.info('collect-news', '파이프라인 시작', { date })
 */
export const logger = {
  /**
   * @param {string} scope - 로그 출처 (모듈명)
   * @param {string} message
   * @param {*} [meta]
   */
  debug(scope, message, meta) {
    log('debug', scope, message, meta);
  },

  /**
   * @param {string} scope
   * @param {string} message
   * @param {*} [meta]
   */
  info(scope, message, meta) {
    log('info', scope, message, meta);
  },

  /**
   * @param {string} scope
   * @param {string} message
   * @param {*} [meta]
   */
  warn(scope, message, meta) {
    log('warn', scope, message, meta);
  },

  /**
   * @param {string} scope
   * @param {string} message
   * @param {*} [meta]
   */
  error(scope, message, meta) {
    log('error', scope, message, meta);
  },
};
