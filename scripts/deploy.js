/**
 * GitHub Pages 배포 모듈
 * docs/ 아래 변경사항을 simple-git으로 add/commit/push하여 GitHub Pages에 배포합니다.
 * 변경이 없으면 정상 종료, 원격 푸시 실패 시 최대 3회 재시도합니다.
 */

import { logger } from './lib/logger.js';
import { withRetry } from './lib/retry.js';
import { ROOT } from './lib/paths.js';
import { kstToday, isoWeek } from './lib/dateUtils.js';

const SCOPE = 'deploy';

/**
 * docs/ 변경사항을 GitHub Pages로 배포합니다.
 * @param {Object} [options]
 * @param {string} [options.date] - 'YYYY-MM-DD' (커밋 메시지용, 기본: 오늘 KST)
 * @param {string} [options.branch] - 기본 'main'
 * @param {string} [options.commitMessage] - 기본 자동 생성
 * @returns {Promise<DeployResult>}
 */
export async function run(options = {}) {
  const date = options.date || kstToday();
  const branch = options.branch || 'main';

  const { default: simpleGit } = await import('simple-git');
  const git = simpleGit(ROOT);

  // Git 사용자 정보 설정 (환경 변수 있을 때만)
  if (process.env.GIT_USER_NAME) {
    await git.addConfig('user.name', process.env.GIT_USER_NAME, false, 'local');
  }
  if (process.env.GIT_USER_EMAIL) {
    await git.addConfig('user.email', process.env.GIT_USER_EMAIL, false, 'local');
  }

  // 커밋 메시지 생성
  const { year, week } = isoWeek(date);
  const [, month] = date.split('-');
  const commitMessage = options.commitMessage ||
    `📰 ${year}년 ${parseInt(month, 10)}월 ${week}주차 뉴스 아카이브`;

  logger.info(SCOPE, `배포 시작`, { date, branch, commitMessage });

  // 현재 변경 상태 확인
  const status = await git.status();
  const docsChanged = status.files.filter((f) => f.path.startsWith('docs/'));

  if (docsChanged.length === 0) {
    logger.info(SCOPE, 'nothing to commit — docs/ 에 변경사항 없음');
    return {
      committed: false,
      commitSha: null,
      pushed: false,
      branch,
      filesChanged: [],
    };
  }

  logger.info(SCOPE, `변경된 파일 ${docsChanged.length}개 발견`, {
    files: docsChanged.map((f) => f.path),
  });

  // docs/ 경로만 stage (data/, logs/, .env 오염 방지)
  await git.add(['docs/']);

  // 커밋
  await git.commit(commitMessage);
  const commitSha = (await git.revparse(['HEAD'])).trim();
  logger.info(SCOPE, `커밋 완료`, { commitSha, message: commitMessage });

  // pull --rebase 후 push (최대 3회 재시도)
  let pushed = false;
  try {
    await withRetry(
      async () => {
        await git.pull('origin', branch, ['--rebase']);
        await git.push('origin', branch);
        pushed = true;
      },
      {
        retries: 3,
        baseDelayMs: 2000,
        factor: 2,
        shouldRetry: (err) => {
          // 인증 실패(403, 401)는 재시도 없이 실패
          const msg = err?.message || '';
          if (msg.includes('403') || msg.includes('401') || msg.includes('Authentication')) {
            return false;
          }
          return true;
        },
      }
    );
    logger.info(SCOPE, `푸시 완료`, { branch, commitSha });
  } catch (err) {
    // 로컬 커밋은 보존, 다음 실행에서 재시도 가능
    logger.error(SCOPE, `푸시 실패 — 로컬 커밋은 보존됨`, {
      error: err.message,
      commitSha,
    });
    // 에러를 다시 throw하지 않고 결과에 반영 (파이프라인 계속 진행)
  }

  return {
    committed: true,
    commitSha,
    pushed,
    branch,
    filesChanged: docsChanged.map((f) => f.path),
  };
}

// CLI 직접 실행 시
const isMain = process.argv[1] && (
  process.argv[1].endsWith('deploy.js') ||
  process.argv[1].endsWith('deploy')
);

if (isMain) {
  const { config } = await import('dotenv');
  config();

  const args = process.argv.slice(2);
  let date = null;
  let branch = 'main';
  let commitMessage = null;

  for (const arg of args) {
    if (arg.startsWith('--date=')) date = arg.split('=')[1];
    else if (arg.startsWith('--branch=')) branch = arg.split('=')[1];
    else if (arg.startsWith('--message=')) commitMessage = arg.split('=').slice(1).join('=');
  }

  try {
    const result = await run({ date, branch, commitMessage });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    logger.error(SCOPE, '실행 실패', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}
