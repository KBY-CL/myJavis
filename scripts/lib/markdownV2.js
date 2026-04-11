/**
 * Telegram MarkdownV2 이스케이프 유틸리티
 * 이스케이프 대상: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * 참조: https://core.telegram.org/bots/api#markdownv2-style
 */

// MarkdownV2 이스케이프 대상 문자 목록
const ESCAPE_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/**
 * 텍스트를 Telegram MarkdownV2 형식으로 이스케이프
 * URL의 ( ) 부분은 이스케이프하지 않음에 주의:
 * 링크 문법 [텍스트](URL) 에서 URL 내부의 괄호는 별도 처리 필요
 * @param {string} text - 이스케이프할 원본 텍스트
 * @returns {string} - 이스케이프된 텍스트
 */
export function escapeV2(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(ESCAPE_CHARS, '\\$&');
}

/**
 * MarkdownV2 포맷팅을 제거하여 plain text로 변환 (fallback 용)
 * 이스케이프 문자의 백슬래시 제거, 굵게/이탤릭 마커 제거
 * @param {string} text - MarkdownV2 포맷 텍스트
 * @returns {string} - plain text
 */
export function stripV2(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // 이스케이프된 특수문자에서 백슬래시 제거: \. -> .
    .replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1')
    // 굵게 마커 제거: *text* -> text
    .replace(/\*([^*]+)\*/g, '$1')
    // 이탤릭 마커 제거: _text_ -> text
    .replace(/_([^_]+)_/g, '$1')
    // 코드 마커 제거: `text` -> text
    .replace(/`([^`]+)`/g, '$1')
    // 취소선 제거: ~text~ -> text
    .replace(/~([^~]+)~/g, '$1')
    // 인라인 링크 [텍스트](URL) -> 텍스트 (URL)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    // 남은 마크다운 문자 정리
    .replace(/[*_`~]/g, '');
}
