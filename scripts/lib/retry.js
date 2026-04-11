/**
 * 지수 백오프 재시도 헬퍼 모듈
 * 외부 API 호출 등 일시적 실패에 대한 자동 재시도 로직 제공
 */

/**
 * 지연 함수
 * @param {number} ms - 대기 시간 (밀리초)
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 기본 재시도 여부 판정 함수
 * 5xx 오류, 네트워크 오류는 재시도, 4xx (단, 429 제외)는 재시도 안 함
 * @param {Error} err
 * @returns {boolean}
 */
function defaultShouldRetry(err) {
  // HTTP 상태 코드가 있는 경우
  const status = err?.status ?? err?.response?.status ?? err?.statusCode;
  if (status) {
    // 429 Rate Limit은 재시도 (retry-after 헤더 처리)
    if (status === 429) return true;
    // 4xx 클라이언트 오류는 재시도 안 함
    if (status >= 400 && status < 500) return false;
    // 5xx 서버 오류는 재시도
    if (status >= 500) return true;
  }
  // 네트워크 오류 코드는 재시도
  const code = err?.code;
  if (code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE'].includes(code)) {
    return true;
  }
  // 기본적으로 재시도
  return true;
}

/**
 * 지수 백오프 재시도 헬퍼
 * @template T
 * @param {() => Promise<T>} fn - 실행할 비동기 함수
 * @param {Object} [opts]
 * @param {number} [opts.retries=3] - 최대 재시도 횟수
 * @param {number} [opts.baseDelayMs=1000] - 초기 지연 (밀리초)
 * @param {number} [opts.factor=2] - 지수 계수
 * @param {(err: Error) => boolean} [opts.shouldRetry] - 재시도 여부 판정 함수
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseDelayMs = 1000,
    factor = 2,
    shouldRetry = defaultShouldRetry,
  } = opts;

  let lastError;
  let attempt = 0;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // 마지막 시도였으면 즉시 throw
      if (attempt >= retries) break;

      // 재시도 여부 판정
      if (!shouldRetry(err)) {
        throw err;
      }

      // 429 Rate Limit: retry-after 헤더 우선 적용
      let delayMs;
      const retryAfter = extractRetryAfter(err);
      if (retryAfter !== null) {
        delayMs = retryAfter * 1000;
      } else {
        // 지수 백오프: baseDelayMs * factor^attempt
        delayMs = baseDelayMs * Math.pow(factor, attempt);
      }

      attempt++;
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * 에러 객체에서 retry-after 값(초) 추출
 * @param {Error} err
 * @returns {number|null}
 */
function extractRetryAfter(err) {
  // 표준 HTTP retry-after 헤더
  if (err?.headers?.['retry-after']) {
    const val = parseInt(err.headers['retry-after'], 10);
    if (!isNaN(val)) return val;
  }
  // Telegram Bot API 에러의 경우 (parameters.retry_after)
  if (err?.response?.body) {
    try {
      const body = typeof err.response.body === 'string'
        ? JSON.parse(err.response.body)
        : err.response.body;
      if (body?.parameters?.retry_after) {
        return body.parameters.retry_after;
      }
    } catch {
      // 파싱 실패 무시
    }
  }
  return null;
}
