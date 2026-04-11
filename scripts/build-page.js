/**
 * HTML 페이지 빌드 모듈
 *
 * 지원 모드:
 *   - daily  (기본): data/daily-{date}.json 또는 formatted-{date}.json 을 읽어
 *                    docs/daily/{date}.html 생성
 *   - weekly       : 해당 주(월-금)의 daily JSON을 모아 docs/{year}/week-{NN}.html 생성
 *   - both         : daily + weekly 동시 실행 (금요일 파이프라인 용도)
 *
 * 실행 후 docs/index.html을 일간/주간 2개 섹션으로 재생성합니다.
 * 외부 의존성 없음 (Node 내장 fs/promises, path 만 사용).
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { logger } from './lib/logger.js';
import {
  ROOT,
  newsFile,
  summaryFile,
  dailyJson,
  dailyHtml,
  formattedFile,
  weekHtml,
  ensureDir,
} from './lib/paths.js';
import { kstToday, isoWeek, weekDates } from './lib/dateUtils.js';

const SCOPE = 'build-page';

// ──────────────────────────────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  ai:        '🤖 AI 뉴스',
  claude:    '🟠 Claude 업데이트',
  it_issues: '🔥 IT 핫이슈',
  webdev:    '💻 웹개발',
};

const CATEGORY_ORDER = ['ai', 'claude', 'it_issues', 'webdev'];

const DAY_NAMES_KO = ['일', '월', '화', '수', '목', '금', '토'];

// ──────────────────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────────────────

function formatDateKo(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}월 ${parseInt(d, 10)}일`;
}

function dayOfWeekKo(dateStr) {
  const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return DAY_NAMES_KO[date.getUTCDay()];
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 단일 날짜의 데이터 로드 (우선순위: daily JSON → formatted JSON → news JSON).
 * build-page.js는 어떤 형식이든 수용 가능하도록 fallback 체인을 가집니다.
 *
 * @param {string} date
 * @returns {Promise<{ date: string, hasData: boolean, categories: Object, articleCount: number }>}
 */
async function loadDayData(date) {
  const result = { date, hasData: false, categories: {}, articleCount: 0 };

  // 1순위: daily-{date}.json (updater가 쓴 한국어 요약 포함)
  const dailyPath = dailyJson(date);
  if (existsSync(dailyPath)) {
    try {
      const data = JSON.parse(await fs.readFile(dailyPath, 'utf-8'));
      let count = 0;
      for (const cat of CATEGORY_ORDER) {
        const articles = data.categories?.[cat] || [];
        result.categories[cat] = articles;
        count += articles.length;
      }
      result.hasData = count > 0;
      result.articleCount = count;
      return result;
    } catch (err) {
      logger.warn(SCOPE, `daily JSON 파싱 실패, fallback 시도`, { date, error: err.message });
    }
  }

  // 2순위: formatted-{date}.json (formatter 출력, 영문 제목 + keyPoints)
  const formattedPath = formattedFile(date);
  if (existsSync(formattedPath)) {
    try {
      const data = JSON.parse(await fs.readFile(formattedPath, 'utf-8'));
      let count = 0;
      for (const cat of CATEGORY_ORDER) {
        const articles = (data.categories?.[cat] || []).map((a) => ({
          koreanTitle: a.originalTitle || '',
          summary: a.keyPoints ? a.keyPoints.slice(0, 2) : [],
          originalTitle: a.originalTitle || '',
          url: a.url,
          source: a.source,
          relevanceScore: a.relevanceScore,
        }));
        result.categories[cat] = articles;
        count += articles.length;
      }
      result.hasData = count > 0;
      result.articleCount = count;
      return result;
    } catch (err) {
      logger.warn(SCOPE, `formatted JSON 파싱 실패, fallback 시도`, { date, error: err.message });
    }
  }

  // 3순위: summary-{date}.json (구 스키마, 하위 호환)
  const summaryPath = summaryFile(date);
  if (existsSync(summaryPath)) {
    try {
      const data = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
      let count = 0;
      for (const cat of CATEGORY_ORDER) {
        const articles = (data.categories?.[cat] || []).filter((a) => a.selected !== false);
        result.categories[cat] = articles;
        count += articles.length;
      }
      result.hasData = count > 0;
      result.articleCount = count;
      return result;
    } catch (err) {
      logger.warn(SCOPE, `summary JSON 파싱 실패, fallback 시도`, { date, error: err.message });
    }
  }

  // 4순위: news-{date}.json (aggregator 원본, keyPoints 를 요약으로 사용)
  const newsPath = newsFile(date);
  if (existsSync(newsPath)) {
    try {
      const data = JSON.parse(await fs.readFile(newsPath, 'utf-8'));
      let count = 0;
      for (const cat of CATEGORY_ORDER) {
        const articles = (data.categories?.[cat] || []).map((a) => ({
          koreanTitle: a.title,
          summary: a.keyPoints ? a.keyPoints.slice(0, 2) : [],
          originalTitle: a.title,
          url: a.url,
          source: a.source,
          relevanceScore: a.relevanceScore,
        }));
        result.categories[cat] = articles;
        count += articles.length;
      }
      result.hasData = count > 0;
      result.articleCount = count;
    } catch (err) {
      logger.warn(SCOPE, `news JSON 파싱 실패`, { date, error: err.message });
    }
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────
// HTML 렌더링 (공용 부분)
// ──────────────────────────────────────────────────────────────────────

const STYLE_SHEET = `
  :root {
    --bg: #ffffff;
    --fg: #1a1a1a;
    --muted: #666;
    --link: #0066cc;
    --border: #e5e5e5;
    --card-bg: #fafafa;
    --heading-bg: #f0f4f8;
    --accent: #0066cc;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e0e10;
      --fg: #e5e5e5;
      --muted: #888;
      --link: #6ab7ff;
      --border: #2a2a2e;
      --card-bg: #17171a;
      --heading-bg: #1a2030;
      --accent: #6ab7ff;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', 'Noto Sans KR', sans-serif;
    background: var(--bg);
    color: var(--fg);
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--link); }
  header.page-header { margin-bottom: 2rem; }
  header.page-header h1 { font-size: 1.8rem; margin-bottom: 0.3rem; letter-spacing: -0.02em; }
  header.page-header .subtitle { color: var(--muted); font-size: 0.95rem; }
  .back-link {
    display: inline-block;
    margin-bottom: 1.25rem;
    color: var(--link);
    text-decoration: none;
    font-size: 0.9rem;
  }
  .back-link:hover { text-decoration: underline; }
  .category-block {
    border: 1px solid var(--border);
    border-radius: 10px;
    margin-bottom: 1rem;
    background: var(--card-bg);
    overflow: hidden;
  }
  .category-block > summary {
    cursor: pointer;
    padding: 0.8rem 1.1rem;
    font-weight: 600;
    font-size: 1rem;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .category-block > summary::-webkit-details-marker { display: none; }
  .category-block .count { font-size: 0.8rem; color: var(--muted); font-weight: 500; }
  .article-list { padding: 0 1.1rem 0.5rem; }
  .article-item {
    padding: 0.9rem 0;
    border-top: 1px solid var(--border);
  }
  .article-item:first-child { border-top: none; }
  .article-title { font-size: 1.02rem; font-weight: 700; margin-bottom: 0.35rem; }
  .summary-line { font-size: 0.92rem; color: var(--fg); margin-bottom: 0.15rem; opacity: 0.85; }
  .article-meta { font-size: 0.82rem; color: var(--muted); margin-top: 0.5rem; }
  .article-meta a { text-decoration: none; }
  .article-meta a:hover { text-decoration: underline; }
  .source { font-weight: 500; }
  .score-badge {
    display: inline-block;
    background: var(--heading-bg);
    color: var(--accent);
    font-size: 0.72rem;
    padding: 0.1rem 0.5rem;
    border-radius: 10px;
    margin-left: 0.4rem;
  }
  .day-section { margin-bottom: 2.5rem; }
  .day-title {
    font-size: 1.15rem;
    padding: 0.6rem 0.85rem;
    background: var(--heading-bg);
    border-left: 3px solid var(--accent);
    border-radius: 0 6px 6px 0;
    margin-bottom: 1rem;
  }
  .no-data { color: var(--muted); font-style: italic; padding: 0.5rem 0; }
  footer { margin-top: 3rem; font-size: 0.82rem; color: var(--muted); text-align: center; border-top: 1px solid var(--border); padding-top: 1.2rem; }
`;

/**
 * 단일 기사 카드
 */
function renderArticleItem(article) {
  const title = escapeHtml(article.koreanTitle || article.originalTitle || '');
  const origTitle =
    article.originalTitle && article.originalTitle !== article.koreanTitle
      ? `<span class="orig-title">${escapeHtml(article.originalTitle)}</span>`
      : '';
  const sum1 = escapeHtml(article.summary?.[0] || '');
  const sum2 = escapeHtml(article.summary?.[1] || '');
  const url = escapeHtml(article.url || '#');
  const source = escapeHtml(article.source || '');
  const score = article.relevanceScore
    ? `<span class="score-badge">★ ${article.relevanceScore}</span>`
    : '';

  return `
          <article class="article-item">
            <h4 class="article-title">${title}${score}</h4>
            ${sum1 ? `<p class="summary-line">${sum1}</p>` : ''}
            ${sum2 ? `<p class="summary-line">${sum2}</p>` : ''}
            <p class="article-meta">
              ${source ? `<span class="source">${source}</span> · ` : ''}
              <a href="${url}" target="_blank" rel="noopener noreferrer">원문 보기</a>
            </p>
          </article>`;
}

/**
 * 카테고리 블록 (아코디언)
 */
function renderCategoryBlock(catKey, articles) {
  if (!articles || articles.length === 0) return '';
  const label = CATEGORY_LABELS[catKey] || catKey;
  const items = articles.map(renderArticleItem).join('');
  return `
        <details class="category-block" open>
          <summary>${escapeHtml(label)}<span class="count">${articles.length}건</span></summary>
          <div class="article-list">${items}
          </div>
        </details>`;
}

// ──────────────────────────────────────────────────────────────────────
// Daily HTML
// ──────────────────────────────────────────────────────────────────────

/**
 * 일간 브리핑 HTML (순수 함수, 테스트 용이)
 * @param {Object} data - { date, dayOfWeek, categories, articleCount }
 * @returns {string}
 */
export function renderDailyHtml(data) {
  const { date, dayOfWeek, categories, articleCount } = data;
  const dateKo = formatDateKo(date);
  const dayKo = dayOfWeek || dayOfWeekKo(date);

  const categoryHtml = CATEGORY_ORDER
    .map((cat) => renderCategoryBlock(cat, categories[cat] || []))
    .filter(Boolean)
    .join('');

  const body = articleCount > 0
    ? `<main>${categoryHtml}\n  </main>`
    : `<main><p class="no-data">이 날의 뉴스 데이터가 없습니다.</p></main>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>📰 ${date} · IT 뉴스 브리핑</title>
  <style>${STYLE_SHEET}</style>
</head>
<body>
  <a class="back-link" href="../index.html">← 목록으로</a>
  <header class="page-header">
    <h1>📰 ${dateKo} (${dayKo}) IT 뉴스</h1>
    <p class="subtitle">일간 브리핑 · 총 ${articleCount}건</p>
  </header>

  ${body}

  <footer>
    <p>자동화 봇이 생성한 일간 뉴스 브리핑입니다.</p>
  </footer>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────
// Weekly HTML
// ──────────────────────────────────────────────────────────────────────

/**
 * 주간 아카이브 HTML (순수 함수)
 * @param {Object} data - { year, weekNumber, startDate, endDate, days }
 * @returns {string}
 */
export function renderWeekHtml(data) {
  const { year, weekNumber, startDate, endDate, days } = data;
  const totalArticles = days.reduce((sum, day) => sum + (day.articleCount || 0), 0);
  const startKo = formatDateKo(startDate);
  const endKo = formatDateKo(endDate);

  const daySections = days.map((day) => {
    const dayKo = dayOfWeekKo(day.date);
    const dayLabel = `${formatDateKo(day.date)} (${dayKo})`;

    if (!day.hasData) {
      return `
    <section class="day-section">
      <h2 class="day-title">${dayLabel}</h2>
      <p class="no-data">데이터 없음</p>
    </section>`;
    }

    const categoryBlocks = CATEGORY_ORDER
      .map((cat) => renderCategoryBlock(cat, day.categories[cat] || []))
      .filter(Boolean)
      .join('');

    return `
    <section class="day-section">
      <h2 class="day-title">${dayLabel} <span class="count">${day.articleCount}건</span></h2>
      ${categoryBlocks}
    </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${year}년 ${weekNumber}주차 IT 뉴스 · ${startKo} - ${endKo}</title>
  <style>${STYLE_SHEET}</style>
</head>
<body>
  <a class="back-link" href="../../index.html">← 목록으로</a>
  <header class="page-header">
    <h1>📰 ${year}년 ${weekNumber}주차 IT 뉴스</h1>
    <p class="subtitle">${startKo} - ${endKo} · 총 ${totalArticles}건</p>
  </header>

  <main>
${daySections}
  </main>

  <footer>
    <p>자동화 봇이 생성한 뉴스 아카이브입니다.</p>
  </footer>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────
// Index HTML
// ──────────────────────────────────────────────────────────────────────

/**
 * index.html 렌더링 (일간 + 주간 섹션)
 * @param {Object} data
 * @param {Array<{ date, dayOfWeek, articleCount, href }>} data.daily
 * @param {Array<{ year, weekNumber, label, href, articleCount }>} data.weekly
 * @returns {string}
 */
export function renderIndexHtml(data) {
  const { daily = [], weekly = [] } = data;

  const dailyItems = daily.length
    ? daily.map((e) => {
        const dayKo = e.dayOfWeek || dayOfWeekKo(e.date);
        return `    <li>
      <a href="${escapeHtml(e.href)}"><strong>${escapeHtml(e.date)}</strong> (${escapeHtml(dayKo)})</a>
      <div class="meta">${e.articleCount}건</div>
    </li>`;
      }).join('\n')
    : '    <li class="empty">아직 등록된 일간 브리핑이 없습니다.</li>';

  const weeklyItems = weekly.length
    ? weekly.map((e) => {
        const label = e.label || `${e.year}년 ${e.weekNumber}주차`;
        return `    <li>
      <a href="${escapeHtml(e.href)}">${escapeHtml(label)}</a>
      ${e.articleCount ? `<div class="meta">${e.articleCount}건</div>` : ''}
    </li>`;
      }).join('\n')
    : '    <li class="empty">아직 등록된 주간 아카이브가 없습니다.</li>';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>📰 IT 뉴스 아카이브</title>
  <style>${STYLE_SHEET}
    section.index-section { margin-bottom: 2.5rem; }
    section.index-section h2 {
      font-size: 1.15rem;
      padding: 0.5rem 0.85rem;
      background: var(--heading-bg);
      border-left: 3px solid var(--accent);
      border-radius: 0 6px 6px 0;
      margin-bottom: 1rem;
    }
    ul.entry-list { list-style: none; padding: 0; }
    ul.entry-list li {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--card-bg);
      margin-bottom: 0.6rem;
      padding: 0.85rem 1.1rem;
    }
    ul.entry-list li.empty { font-style: italic; color: var(--muted); background: transparent; border: 1px dashed var(--border); }
    ul.entry-list li a {
      text-decoration: none;
      font-weight: 600;
      font-size: 1rem;
    }
    ul.entry-list li a:hover { text-decoration: underline; }
    ul.entry-list li .meta { font-size: 0.82rem; color: var(--muted); margin-top: 0.2rem; }
  </style>
</head>
<body>
  <header class="page-header">
    <h1>📰 IT 뉴스 아카이브</h1>
    <p class="subtitle">매일 아침 AI · Claude · IT · 웹개발 브리핑</p>
  </header>

  <section class="index-section">
    <h2>🗓️ 일간 브리핑</h2>
    <!-- DAILY_LINKS_START -->
    <ul class="entry-list" id="daily-list">
${dailyItems}
    </ul>
    <!-- DAILY_LINKS_END -->
  </section>

  <section class="index-section">
    <h2>📚 주간 아카이브</h2>
    <!-- WEEK_LINKS_START -->
    <ul class="entry-list" id="weekly-list">
${weeklyItems}
    </ul>
    <!-- WEEK_LINKS_END -->
  </section>

  <footer>
    <p>자동화 봇이 생성한 뉴스 아카이브입니다.</p>
  </footer>
</body>
</html>`;
}

/**
 * 기존 index.html에서 일간·주간 엔트리 파싱
 * @param {string} html
 * @returns {{ daily: Array, weekly: Array }}
 */
function parseIndexEntries(html) {
  const daily = [];
  const weekly = [];

  // 일간 섹션: <a href="./daily/YYYY-MM-DD.html"><strong>YYYY-MM-DD</strong> (요일)</a>
  const dailyBlock = html.match(/<!-- DAILY_LINKS_START -->([\s\S]*?)<!-- DAILY_LINKS_END -->/);
  if (dailyBlock) {
    const re = /<a href="([^"]*)"><strong>([^<]+)<\/strong>\s*\(([^)]+)\)<\/a>[\s\S]*?<div class="meta">(\d+)건<\/div>/g;
    let m;
    while ((m = re.exec(dailyBlock[1])) !== null) {
      daily.push({
        href: m[1],
        date: m[2].trim(),
        dayOfWeek: m[3].trim(),
        articleCount: parseInt(m[4], 10) || 0,
      });
    }
  }

  // 주간 섹션: <a href="./2026/week-15.html">2026년 15주차 · 4월 6일 - 4월 10일</a>
  const weeklyBlock = html.match(/<!-- WEEK_LINKS_START -->([\s\S]*?)<!-- WEEK_LINKS_END -->/);
  if (weeklyBlock) {
    const re = /<a href="([^"]*)">([^<]+)<\/a>(?:[\s\S]*?<div class="meta">(\d+)건<\/div>)?/g;
    let m;
    while ((m = re.exec(weeklyBlock[1])) !== null) {
      const href = m[1];
      const label = m[2].trim();
      const articleCount = m[3] ? parseInt(m[3], 10) || 0 : 0;
      const hrefMatch = href.match(/(\d{4})\/week-(\d+)\.html/);
      if (hrefMatch) {
        weekly.push({
          year: parseInt(hrefMatch[1], 10),
          weekNumber: parseInt(hrefMatch[2], 10),
          href,
          label,
          articleCount,
        });
      }
    }
  }

  return { daily, weekly };
}

/**
 * index.html 업데이트 (기존 엔트리 보존 + 신규 항목 upsert)
 */
async function updateIndex(options) {
  const { newDaily, newWeekly } = options;
  const indexPath = path.join(ROOT, 'docs', 'index.html');

  let existing = { daily: [], weekly: [] };
  if (existsSync(indexPath)) {
    try {
      const html = await fs.readFile(indexPath, 'utf-8');
      existing = parseIndexEntries(html);
    } catch (err) {
      logger.warn(SCOPE, `기존 index.html 파싱 실패, 새로 생성`, { error: err.message });
    }
  }

  // Daily upsert
  if (newDaily) {
    const idx = existing.daily.findIndex((e) => e.date === newDaily.date);
    if (idx >= 0) existing.daily[idx] = newDaily;
    else existing.daily.unshift(newDaily);
    existing.daily.sort((a, b) => b.date.localeCompare(a.date));
  }

  // Weekly upsert
  if (newWeekly) {
    const idx = existing.weekly.findIndex(
      (e) => e.year === newWeekly.year && e.weekNumber === newWeekly.weekNumber
    );
    if (idx >= 0) existing.weekly[idx] = newWeekly;
    else existing.weekly.unshift(newWeekly);
    existing.weekly.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.weekNumber - a.weekNumber;
    });
  }

  const html = renderIndexHtml(existing);
  await ensureDir(path.dirname(indexPath));
  await fs.writeFile(indexPath, html, 'utf-8');
  logger.info(SCOPE, `index.html 업데이트 완료`, {
    dailyCount: existing.daily.length,
    weeklyCount: existing.weekly.length,
  });

  return indexPath;
}

// ──────────────────────────────────────────────────────────────────────
// 빌드 엔트리포인트
// ──────────────────────────────────────────────────────────────────────

/**
 * 일간 페이지 빌드
 */
async function buildDaily(date) {
  const day = await loadDayData(date);

  if (!day.hasData) {
    throw new Error(`${date}의 뉴스 데이터가 없습니다 (daily/formatted/summary/news 모두 부재).`);
  }

  const html = renderDailyHtml({
    date,
    dayOfWeek: dayOfWeekKo(date),
    categories: day.categories,
    articleCount: day.articleCount,
  });

  const filePath = dailyHtml(date);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, html, 'utf-8');
  logger.info(SCOPE, `일간 페이지 저장: ${filePath}`, { articleCount: day.articleCount });

  return { filePath, articleCount: day.articleCount };
}

/**
 * 주간 페이지 빌드
 */
async function buildWeekly(date, year, weekNumber) {
  const dates = weekDates(date);
  const startDate = dates[0];
  const endDate = dates[4];

  const days = [];
  let totalArticleCount = 0;
  for (const d of dates) {
    const day = await loadDayData(d);
    days.push(day);
    totalArticleCount += day.articleCount;
  }

  const html = renderWeekHtml({ year, weekNumber, startDate, endDate, days });

  const filePath = weekHtml(year, weekNumber);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, html, 'utf-8');
  logger.info(SCOPE, `주간 페이지 저장: ${filePath}`, { totalArticleCount });

  return { filePath, totalArticleCount, startDate, endDate };
}

/**
 * 빌드 진입점.
 * @param {Object} options
 * @param {string} [options.date]    - 'YYYY-MM-DD' (기본: 오늘 KST)
 * @param {string} [options.mode]    - 'daily' (기본) | 'weekly' | 'both'
 * @param {number} [options.year]    - weekly 모드 override
 * @param {number} [options.weekNumber]
 * @returns {Promise<Object>}
 */
export async function run(options = {}) {
  const date = options.date || kstToday();
  const mode = options.mode || 'daily';
  const { year: isoYear, week: isoWeekNum } = isoWeek(date);
  const year = options.year || isoYear;
  const weekNumber = options.weekNumber || isoWeekNum;

  logger.info(SCOPE, `빌드 시작`, { date, mode, year, weekNumber });

  const result = { date, mode, daily: null, weekly: null, indexFile: null };

  let newDaily = null;
  let newWeekly = null;

  if (mode === 'daily' || mode === 'both') {
    const out = await buildDaily(date);
    result.daily = { file: out.filePath, articleCount: out.articleCount };
    newDaily = {
      date,
      dayOfWeek: dayOfWeekKo(date),
      articleCount: out.articleCount,
      href: `./daily/${date}.html`,
    };
  }

  if (mode === 'weekly' || mode === 'both') {
    const out = await buildWeekly(date, year, weekNumber);
    result.weekly = {
      file: out.filePath,
      year,
      weekNumber,
      totalArticleCount: out.totalArticleCount,
    };
    const weekStr = String(weekNumber).padStart(2, '0');
    newWeekly = {
      year,
      weekNumber,
      href: `./${year}/week-${weekStr}.html`,
      label: `${year}년 ${weekNumber}주차 · ${formatDateKo(out.startDate)} - ${formatDateKo(out.endDate)}`,
      articleCount: out.totalArticleCount,
    };
  }

  result.indexFile = await updateIndex({ newDaily, newWeekly });
  logger.info(SCOPE, `빌드 완료`, { mode, daily: !!newDaily, weekly: !!newWeekly });
  return result;
}

// ──────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && (
  process.argv[1].endsWith('build-page.js') ||
  process.argv[1].endsWith('build-page')
);

if (isMain) {
  const args = process.argv.slice(2);
  const opts = {};
  for (const arg of args) {
    if (arg.startsWith('--date=')) opts.date = arg.split('=')[1];
    else if (arg.startsWith('--mode=')) opts.mode = arg.split('=')[1];
    else if (arg.startsWith('--year=')) opts.year = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--week=')) opts.weekNumber = parseInt(arg.split('=')[1], 10);
  }

  try {
    const result = await run(opts);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    logger.error(SCOPE, '실행 실패', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}
