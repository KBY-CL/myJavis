/**
 * 텔레그램 메시지 전송 모듈
 * data/message-{date}.txt (또는 분할 파일)을 읽어 Telegram Bot API로 전송합니다.
 * MarkdownV2 파싱 에러 발생 시 plain text fallback으로 재전송합니다.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { logger } from './lib/logger.js';
import { withRetry } from './lib/retry.js';
import { messageFile, ensureDir, logFile, ROOT } from './lib/paths.js';
import { stripV2 } from './lib/markdownV2.js';

const SCOPE = 'telegram';

/**
 * Telegram Bot 인스턴스 생성 (지연 로딩)
 */
let _bot = null;

async function getBot() {
  if (_bot) return _bot;
  const { default: TelegramBot } = await import('node-telegram-bot-api');
  _bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  return _bot;
}

/**
 * 분할된 메시지 파일 목록 수집
 * message-{date}.txt 또는 message-{date}-1.txt, message-{date}-2.txt ... 형식 지원
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string[]} - 존재하는 메시지 파일 경로 배열 (정렬됨)
 */
async function collectMessageFiles(date) {
  const files = [];

  // 단일 파일 확인
  const singlePath = messageFile(date);
  if (existsSync(singlePath)) {
    files.push(singlePath);
    return files;
  }

  // 분할 파일 확인 (최대 10개)
  for (let n = 1; n <= 10; n++) {
    const splitPath = messageFile(date, n);
    if (existsSync(splitPath)) {
      files.push(splitPath);
    } else {
      break;
    }
  }

  return files;
}

/**
 * 단일 텍스트 전송 (내부 헬퍼)
 * @param {string} text - 전송할 텍스트
 * @param {Object} opts
 * @param {string} [opts.parseMode='MarkdownV2'] - 파싱 모드
 * @param {boolean} [opts.disablePreview=true] - 웹 미리보기 비활성화
 * @returns {Promise<{ messageId: number, chars: number }>}
 */
export async function sendText(text, opts = {}) {
  const {
    parseMode = 'MarkdownV2',
    disablePreview = true,
  } = opts;

  const bot = await getBot();
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const messageOpts = {
    disable_web_page_preview: disablePreview,
  };

  if (parseMode !== 'plain') {
    messageOpts.parse_mode = parseMode;
  }

  const result = await bot.sendMessage(chatId, text, messageOpts);
  return {
    messageId: result.message_id,
    chars: text.length,
  };
}

/**
 * 일일 텔레그램 메시지 파일을 전송합니다.
 * @param {Object} options
 * @param {string} options.date - 'YYYY-MM-DD'
 * @param {string} [options.parseMode='MarkdownV2'] - 파싱 모드
 * @param {boolean} [options.disablePreview=true] - 웹 미리보기 비활성화
 * @returns {Promise<SendResult>}
 */
export async function run(options) {
  const { date, parseMode = 'MarkdownV2', disablePreview = true } = options;

  logger.info(SCOPE, `텔레그램 전송 시작`, { date });

  // 전송할 메시지 파일 수집
  const msgFiles = await collectMessageFiles(date);

  if (msgFiles.length === 0) {
    throw new Error(`전송할 메시지 파일을 찾을 수 없습니다: data/message-${date}*.txt`);
  }

  logger.info(SCOPE, `메시지 파일 ${msgFiles.length}개 발견`, { files: msgFiles.map(f => path.basename(f)) });

  const sent = [];
  const failed = [];
  let fallbackUsed = false;

  for (let i = 0; i < msgFiles.length; i++) {
    const filePath = msgFiles[i];
    const fileName = path.basename(filePath);

    // 분할 메시지 간 1초 간격 (첫 번째 제외)
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    let text;
    try {
      text = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      logger.error(SCOPE, `메시지 파일 읽기 실패`, { file: fileName, error: err.message });
      failed.push({ file: fileName, error: err.message, attempts: 0 });
      continue;
    }

    let attempts = 0;

    try {
      // MarkdownV2로 전송 시도 (재시도 3회, 5초 간격)
      const result = await withRetry(
        async () => {
          attempts++;
          return sendText(text, { parseMode, disablePreview });
        },
        {
          retries: 3,
          baseDelayMs: 5000,
          factor: 1, // 텔레그램은 고정 5초 간격
          shouldRetry: (err) => {
            const status = err?.response?.statusCode ?? err?.code;
            // MarkdownV2 파싱 에러는 재시도 안 함 (fallback 처리)
            if (err?.message?.includes("can't parse entities")) return false;
            if (err?.message?.includes('Bad Request')) return false;
            // 429는 재시도
            if (status === 429) return true;
            // 4xx 클라이언트 오류는 재시도 안 함
            if (typeof status === 'number' && status >= 400 && status < 500) return false;
            return true;
          },
        }
      );

      sent.push({ file: fileName, messageId: result.messageId, chars: result.chars });
      logger.info(SCOPE, `전송 성공`, { file: fileName, messageId: result.messageId });

    } catch (err) {
      // MarkdownV2 파싱 에러 → plain text fallback
      if (err?.message?.includes("can't parse entities") || err?.message?.includes('Bad Request')) {
        logger.warn(SCOPE, `MarkdownV2 파싱 오류, plain text fallback 시도`, { file: fileName, error: err.message });
        fallbackUsed = true;

        try {
          const plainText = stripV2(text);
          const result = await sendText(plainText, { parseMode: 'plain', disablePreview });
          sent.push({ file: fileName, messageId: result.messageId, chars: result.chars });
          logger.info(SCOPE, `plain text fallback 전송 성공`, { file: fileName, messageId: result.messageId });
        } catch (fallbackErr) {
          logger.error(SCOPE, `plain text fallback도 실패`, { file: fileName, error: fallbackErr.message });
          failed.push({ file: fileName, error: fallbackErr.message, attempts });
        }
      } else {
        // 그 외 오류: 로그 후 계속 진행 (파이프라인 중단 안 함)
        logger.error(SCOPE, `전송 최종 실패`, { file: fileName, error: err.message, attempts });
        failed.push({ file: fileName, error: err.message, attempts });
      }
    }
  }

  const result = { date, sent, failed, fallbackUsed };
  logger.info(SCOPE, `텔레그램 전송 완료`, {
    successCount: sent.length,
    failCount: failed.length,
    fallbackUsed,
  });

  return result;
}

// CLI 직접 실행 시
const isMain = process.argv[1] && (
  process.argv[1].endsWith('send-telegram.js') ||
  process.argv[1].endsWith('send-telegram')
);

if (isMain) {
  const { config } = await import('dotenv');
  config();

  const args = process.argv.slice(2);
  let date = null;

  for (const arg of args) {
    if (arg.startsWith('--date=')) {
      date = arg.split('=')[1];
    }
  }

  if (!date) {
    const { kstToday } = await import('./lib/dateUtils.js');
    date = kstToday();
  }

  try {
    const result = await run({ date });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.failed.length > 0 ? 1 : 0);
  } catch (err) {
    logger.error(SCOPE, '실행 실패', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}
