/**
 * KST 날짜 유틸리티 모듈
 * Node 내장 Intl.DateTimeFormat 사용 (moment/dayjs 사용 금지)
 * ISO 주차 계산, 금요일 판정, 주간 날짜 배열 제공
 */

/**
 * KST(Asia/Seoul) 기준 오늘 날짜 반환
 * @returns {string} 'YYYY-MM-DD'
 */
export function kstToday() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * KST(Asia/Seoul) 기준 현재 시간 ISO-8601 +09:00 반환
 * @returns {string} 'YYYY-MM-DDTHH:mm:ss+09:00'
 */
export function kstNow() {
  const now = new Date();
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
  // sv-SE 로케일은 'YYYY-MM-DD HH:mm:ss' 형식
  const parts = formatter.format(now);
  // 'YYYY-MM-DD HH:mm:ss' -> 'YYYY-MM-DDTHH:mm:ss+09:00'
  return parts.replace(' ', 'T') + '+09:00';
}

/**
 * 날짜 문자열을 Date 객체(UTC midnight)로 파싱
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {Date}
 */
function parseDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  // UTC 기준으로 파싱하여 타임존 오프셋 영향 방지
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * ISO 8601 주 번호 계산
 * ISO 주는 월요일 시작, 1월 4일이 포함된 주가 1주차
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {{ year: number, week: number }}
 */
export function isoWeek(dateStr) {
  const date = parseDate(dateStr);

  // ISO 주의 목요일 기준 연도를 사용
  // 해당 날짜가 속한 주의 목요일 날짜 계산
  // JavaScript getDay(): 0=일, 1=월, ..., 6=토
  const dayOfWeek = date.getUTCDay();
  // ISO: 1=월, 2=화, ..., 7=일
  const isoDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;

  // 해당 주 목요일 = 현재 날짜 + (4 - isoDayOfWeek)일
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + (4 - isoDayOfWeek));

  // 목요일이 속한 연도의 1월 1일
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));

  // 주 번호 = (목요일 - 연도 첫날) / 7 + 1
  const weekNumber = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);

  return { year: thursday.getUTCFullYear(), week: weekNumber };
}

/**
 * 주어진 날짜가 금요일인지 판정 (KST 기준)
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {boolean}
 */
export function isFriday(dateStr) {
  const date = parseDate(dateStr);
  // UTC midnight 기준 날짜 사용 (KST 날짜를 'YYYY-MM-DD'로 받으므로 UTC 파싱 사용)
  return date.getUTCDay() === 5;
}

/**
 * 주어진 날짜가 포함된 주의 월~금 날짜 배열 반환
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {string[]} - ['YYYY-MM-DD', ...] 5개 (월~금)
 */
export function weekDates(dateStr) {
  const date = parseDate(dateStr);
  const dayOfWeek = date.getUTCDay();
  // ISO: 월요일 = 1, 일요일 = 7 (0을 7로 변환)
  const isoDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;

  // 이번 주 월요일
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (isoDayOfWeek - 1));

  const dates = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    // 'YYYY-MM-DD' 형식 변환
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }

  return dates;
}
