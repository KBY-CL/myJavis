/**
 * 파일 경로 빌더 모듈
 * data/, docs/, logs/ 경로를 일관되게 생성하는 유틸리티
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// 프로젝트 루트 절대경로 (scripts/lib/ 기준 2레벨 상위)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

/**
 * data/news-YYYY-MM-DD.json 경로 반환
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string}
 */
export function newsFile(date) {
  return path.join(ROOT, 'data', `news-${date}.json`);
}

/**
 * data/summary-YYYY-MM-DD.json 경로 반환
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string}
 */
export function summaryFile(date) {
  return path.join(ROOT, 'data', `summary-${date}.json`);
}

/**
 * data/message-YYYY-MM-DD[-n].txt 경로 반환
 * @param {string} date - 'YYYY-MM-DD'
 * @param {number|null} [n] - 분할 번호 (null이면 분할 없음)
 * @returns {string}
 */
export function messageFile(date, n = null) {
  if (n !== null && n !== undefined) {
    return path.join(ROOT, 'data', `message-${date}-${n}.txt`);
  }
  return path.join(ROOT, 'data', `message-${date}.txt`);
}

/**
 * logs/{scope}-YYYY-MM-DD.log 경로 반환
 * @param {string} scope - 로그 범위 (예: 'collect', 'telegram', 'deploy')
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string}
 */
export function logFile(scope, date) {
  return path.join(ROOT, 'logs', `${scope}-${date}.log`);
}

/**
 * docs/{year}/week-{NN}.html 경로 반환
 * 주 번호는 2자리 0-padding
 * @param {number} year - 년도
 * @param {number} wn - ISO 주 번호
 * @returns {string}
 */
export function weekHtml(year, wn) {
  const weekStr = String(wn).padStart(2, '0');
  return path.join(ROOT, 'docs', String(year), `week-${weekStr}.html`);
}

/**
 * docs/daily/YYYY-MM-DD.html 경로 반환 (일간 브리핑 페이지)
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string}
 */
export function dailyHtml(date) {
  return path.join(ROOT, 'docs', 'daily', `${date}.html`);
}

/**
 * data/daily-YYYY-MM-DD.json 경로 반환
 * (updater가 생성한 한국어 요약 구조체)
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string}
 */
export function dailyJson(date) {
  return path.join(ROOT, 'data', `daily-${date}.json`);
}

/**
 * data/news-{category}-YYYY-MM-DD.json 경로 반환
 * (카테고리별 researcher 에이전트 출력)
 * @param {string} category - 'ai' | 'claude' | 'it' | 'webdev'
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string}
 */
export function categoryNewsFile(category, date) {
  return path.join(ROOT, 'data', `news-${category}-${date}.json`);
}

/**
 * data/formatted-YYYY-MM-DD.json 경로 반환
 * (formatter 에이전트 출력 — 상위 10건 정규화)
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string}
 */
export function formattedFile(date) {
  return path.join(ROOT, 'data', `formatted-${date}.json`);
}

/**
 * 디렉토리가 없으면 생성 (mkdir -p)
 * @param {string} dirPath - 생성할 디렉토리 경로
 * @returns {Promise<void>}
 */
export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}
