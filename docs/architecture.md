# Architecture Document — IT 뉴스 자동화 봇

> 매일 아침 8시 AI/Claude/IT/웹개발 뉴스를 수집하여 텔레그램으로 전송하고,
> 주간 아카이브를 GitHub Pages에 배포하는 멀티 에이전트 자동화 서비스의 설계 문서.
>
> **외부 LLM API 호출이 전혀 없습니다.** 뉴스 수집과 한국어 요약은 모두
> Claude Code 세션 안의 서브에이전트(researcher / updater)가 담당하며,
> Node 스크립트는 텔레그램 전송, HTML 빌드, Git 배포만 책임집니다.

---

## 1. 디렉토리 구조

```
it-news-bot-agents/
├── CLAUDE.md                       # 프로젝트 지침
├── package.json                    # Node 의존성 (3개: telegram, simple-git, dotenv)
├── package-lock.json
├── .env                            # 실제 시크릿 (gitignore, 절대 커밋 금지)
├── .env.example                    # 환경 변수 템플릿
├── .gitignore
├── .nvmrc                          # Node 18+
│
├── .claude/                        # 에이전트 / 스킬 정의
│   ├── agents/
│   │   ├── architect.md
│   │   ├── builder.md
│   │   ├── validator.md
│   │   ├── researcher.md           # WebSearch + WebFetch로 뉴스 수집
│   │   ├── updater.md              # 한국어 요약 + 메시지 빌드
│   │   └── notifier.md             # 텔레그램 전송 (Bash로 send-telegram.js 호출)
│   └── skills/
│       ├── build-service/SKILL.md
│       └── collect-news/SKILL.md
│
├── scripts/                        # 외부 서비스 어댑터 (Node.js, ESM)
│   ├── send-telegram.js            # Telegram Bot API 전송
│   ├── build-page.js               # 주간 HTML 아카이브 빌드 (외부 의존성 없음)
│   ├── deploy.js                   # GitHub Pages 배포 (simple-git)
│   └── lib/                        # 공통 유틸 모듈
│       ├── logger.js               # 구조화 로깅
│       ├── retry.js                # 지수 백오프 재시도 헬퍼
│       ├── paths.js                # 파일 경로 빌더
│       ├── dateUtils.js            # KST 날짜, ISO 주차
│       └── markdownV2.js           # Telegram MarkdownV2 이스케이프
│
├── data/                           # 에이전트 산출물 (gitignore)
│   ├── news-YYYY-MM-DD.json        # researcher 산출 (원본 뉴스)
│   ├── summary-YYYY-MM-DD.json     # updater 산출 (한국어 요약, 선택적)
│   └── message-YYYY-MM-DD.txt      # updater 산출 (텔레그램 전송용)
│
├── docs/                           # GitHub Pages 루트 (커밋됨)
│   ├── architecture.md             # 본 문서
│   ├── index.html                  # 주차 링크 목록 (build-page.js가 prepend)
│   └── 2026/
│       └── week-15.html
│
├── logs/                           # 실행 로그 (gitignore)
│   ├── telegram-YYYY-MM-DD.log
│   └── deploy-YYYY-MM-DD.log
│
└── node_modules/                   # (gitignore)
```

### 1.1 모듈 의존성 그래프

```
build-page.js                  send-telegram.js              deploy.js
   └── lib/logger                  └── node-telegram-bot-api      └── simple-git
   └── lib/paths                   └── lib/markdownV2             └── lib/logger
   └── lib/dateUtils               └── lib/logger                 └── lib/retry
   (외부 라이브러리 없음)             └── lib/retry
                                   └── lib/paths
```

3개 핵심 스크립트는 서로 직접 import 하지 않습니다 — 오케스트레이션은
스킬(`/collect-news`)이 에이전트와 Bash 호출을 순차 실행하여 처리합니다.

---

## 2. 모듈 스펙

### 2.1 `scripts/send-telegram.js` — 텔레그램 전송

#### 책임
- `data/message-{date}.txt`(또는 분할 파일 `message-{date}-{n}.txt`)을 읽어 Telegram Bot API로 전송.
- MarkdownV2 파싱 에러 발생 시 plain text fallback으로 재전송.
- 결과를 `logs/telegram-{date}.log`에 append.

#### 입력 / 출력
- 입력: `data/message-{YYYY-MM-DD}.txt` (또는 분할 파일)
- 출력: `logs/telegram-{YYYY-MM-DD}.log`, 반환값으로 `message_id` 배열

#### 함수 시그니처
```js
export async function run(options)
//   options.date         (필수, 'YYYY-MM-DD')
//   options.parseMode    (기본 'MarkdownV2', 'plain' 가능)
//   options.disablePreview (기본 true)
//
// 반환: { date, sent: [...], failed: [...], fallbackUsed: boolean }

export async function sendText(text, opts)
//   내부 헬퍼 (테스트용 export)
//   반환: { messageId, chars }
```

#### 호출 패턴
```
bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })
for each message file:
  try MarkdownV2 send (재시도 3회, 5초 간격, 429는 retry_after 존중)
  catch parse error:
    plain text fallback (stripV2 로 포맷 제거 후 재전송)
  sleep 1초 (분할 메시지 간격)
```

#### 의존성
- 외부: `node-telegram-bot-api ^0.66`, `dotenv`
- 내부: `lib/retry`, `lib/logger`, `lib/paths`, `lib/markdownV2`

#### CLI
```
node scripts/send-telegram.js [--date=YYYY-MM-DD]
```

---

### 2.2 `scripts/build-page.js` — 주간 HTML 아카이브

#### 책임
- 주어진 주(기본: 오늘이 속한 ISO 주)의 `data/news-*.json` 또는 `data/summary-*.json`을 읽어
  `docs/{year}/week-{NN}.html` 생성.
- `docs/index.html`을 갱신하여 신규 주차 링크 prepend (기존 링크는 보존).
- summary 파일이 없으면 news.json의 `keyPoints[0..1]`을 요약으로 fallback 사용.

#### 입력 / 출력
- 입력: `data/news-YYYY-MM-DD.json` (월~금 5일치) 또는 `data/summary-YYYY-MM-DD.json`
- 출력: `docs/{YYYY}/week-{NN}.html`, `docs/index.html`

#### 함수 시그니처
```js
export async function run(options = {})
//   options.date        (기본: 오늘 KST)
//   options.year        (override)
//   options.weekNumber  (override)
//
// 반환: { year, weekNumber, weekFile, indexFile, dayCount, articleCount }

export function renderWeekHtml(data)   // 순수 함수, 테스트 용이
export function renderIndexHtml(entries)
```

#### HTML 스펙
- 다크모드 `prefers-color-scheme` 지원, 반응형 (max-width 720px).
- `<details>` 아코디언으로 카테고리별 그룹화.
- 각 기사: 한국어 제목 / 2줄 요약 / 출처 / 원문 링크 (`target="_blank" rel="noopener"`).
- index.html은 `<!-- WEEK_LINKS_START/END -->` 마커로 주차 목록 영역 식별.

#### 의존성
- 외부: 없음 (Node 내장 `fs/promises`, `path`만 사용)
- 내부: `lib/paths`, `lib/dateUtils`, `lib/logger`

#### CLI
```
node scripts/build-page.js [--date=YYYY-MM-DD] [--year=2026] [--week=15]
```

---

### 2.3 `scripts/deploy.js` — GitHub Pages 배포

#### 책임
- `docs/` 하위 변경사항을 `simple-git`으로 add/commit/push.
- 변경 없으면 "nothing to commit"으로 정상 종료.
- push 실패 시 `git pull --rebase` 후 재시도 (최대 3회).

#### 입력 / 출력
- 입력: `docs/` 디렉토리 변경 상태
- 출력: `logs/deploy-YYYY-MM-DD.log`, 반환값 `{ committed, commitSha, pushed, branch, filesChanged }`

#### 함수 시그니처
```js
export async function run(options = {})
//   options.date           (커밋 메시지용)
//   options.branch         (기본 'main')
//   options.commitMessage  (기본 자동 생성)
```

#### 동작
```
git = simpleGit(ROOT)
status = await git.status()
if (status.files.length === 0) return  // nothing to commit

await git.add(['docs/'])  // docs/ 만 stage (data/, logs/, .env 오염 방지)
await git.commit(commitMessage)
withRetry(() => git.pull('origin', branch, ['--rebase']).then(() => git.push('origin', branch)),
          { retries: 3, baseDelayMs: 2000 })
```

- **인증**: 로컬 OS credential helper. CI 환경에서는 `GITHUB_TOKEN`을 remote URL에 주입.

#### 의존성
- 외부: `simple-git ^3.24`
- 내부: `lib/logger`, `lib/retry`, `lib/dateUtils`

#### CLI
```
node scripts/deploy.js [--date=YYYY-MM-DD] [--branch=main]
```

---

### 2.4 공통 라이브러리 (`scripts/lib/`)

#### `lib/logger.js`
```js
export const logger = {
  info(scope, message, meta),
  warn(scope, message, meta),
  error(scope, message, meta)
}
// 출력: stdout + logs/{scope}-{date}.log append
// 포맷: [2026-04-11 08:01:23+09:00] [INFO] [telegram] message {meta}
```

#### `lib/retry.js`
```js
export async function withRetry(fn, opts)
//   opts.retries        (기본 3)
//   opts.baseDelayMs    (기본 1000)
//   opts.factor         (기본 2)
//   opts.shouldRetry    (err => boolean)
```

#### `lib/paths.js`
```js
export const ROOT
export function newsFile(date)
export function summaryFile(date)
export function messageFile(date, n)
export function logFile(scope, date)
export function weekHtml(year, weekNumber)
export async function ensureDir(path)  // mkdir -p
```

#### `lib/dateUtils.js`
```js
export function kstToday()       // 'YYYY-MM-DD' (Asia/Seoul)
export function kstNow()         // ISO-8601 +09:00
export function isoWeek(date)    // { year, week }
export function isFriday(date)
export function weekDates(date)  // 월-금 5일치 'YYYY-MM-DD' 배열
```

#### `lib/markdownV2.js`
```js
// 이스케이프 대상: _ * [ ] ( ) ~ ` > # + - = | { } . !
export function escapeV2(text)
export function stripV2(text)    // fallback 용
```

---

## 3. 데이터 스키마

### 3.1 `data/news-{YYYY-MM-DD}.json` (researcher 산출물)

```json
{
  "date": "2026-04-11",
  "collectedAt": "2026-04-11T08:00:00+09:00",
  "totalArticles": 15,
  "categories": {
    "ai": [
      {
        "title": "Original article title",
        "url": "https://techcrunch.com/...",
        "source": "TechCrunch",
        "keyPoints": [
          "핵심 내용 1 (한국어)",
          "핵심 내용 2 (한국어)"
        ],
        "publishedAt": "2026-04-11",
        "relevanceScore": 9
      }
    ],
    "claude": [],
    "it_issues": [],
    "webdev": []
  }
}
```

| 필드 | 타입 | 필수 |
|---|---|---|
| `date` | string (YYYY-MM-DD) | Y |
| `collectedAt` | string (ISO-8601) | Y |
| `categories.{key}` | Article[] | Y (4개 카테고리) |
| `Article.title` | string | Y |
| `Article.url` | string (URL) | Y |
| `Article.keyPoints` | string[] | Y (한국어, 2~5개) |
| `Article.relevanceScore` | integer | Y (1~10) |

researcher 에이전트가 WebSearch/WebFetch로 수집해 한국어 keyPoints를 포함하여 작성합니다.

---

### 3.2 `data/summary-{YYYY-MM-DD}.json` (updater 산출물, **선택적**)

build-page.js는 이 파일이 있으면 우선 사용하고, 없으면 news.json의 `keyPoints`로 fallback합니다.
updater가 더 정제된 한국어 요약을 만들고 싶을 때만 생성합니다.

```json
{
  "date": "2026-04-11",
  "summarizedAt": "2026-04-11T08:02:15+09:00",
  "categories": {
    "ai": [
      {
        "originalTitle": "Original article title",
        "koreanTitle": "오픈AI 신규 모델 공개",
        "summary": [
          "오픈AI가 GPT 신모델을 공개하며 추론 성능을 강화했다.",
          "개발자 API는 다음 주부터 단계적으로 제공된다."
        ],
        "url": "https://techcrunch.com/...",
        "source": "TechCrunch",
        "relevanceScore": 9,
        "selected": true
      }
    ]
  }
}
```

- `selected: true` — 텔레그램 메시지에 포함된 상위 N개.
- `summary` 길이 정확히 2, 각 요소 40자 이내.
- `koreanTitle` 15자 이내.

---

### 3.3 `data/message-{YYYY-MM-DD}.txt` (updater 산출물, 텔레그램 전송용)

**MarkdownV2 포맷.** updater 에이전트가 이 파일을 직접 작성하며, 모든 특수문자
(`. - ( ) ! > # + = | { } _ * [ ] ~`)를 `\` 로 이스케이프합니다.

```
📰 *IT 뉴스 브리핑* · 2026\.04\.11

🤖 *AI 뉴스*
• *오픈AI 신규 모델 공개*
  오픈AI가 GPT 신모델을 공개하며 추론 성능을 강화했다\.
  개발자 API는 다음 주부터 단계적으로 제공된다\.
  [원문 보기](https://techcrunch.com/...)

🟠 *Claude 업데이트*
• ...

🔥 *IT 핫이슈*
• ...

💻 *웹개발*
• ...
```

- 전체 길이 4096자 이내. 초과 시 카테고리 경계에서 분할 (`message-{date}-1.txt`, `-2.txt`).
- URL 괄호 안의 `(`, `)` 는 이스케이프하지 않음.

---

## 4. 데이터 흐름

### 4.1 일일 파이프라인 (Phase 2 — `/collect-news` 스킬)

```
   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │  researcher  │    │   updater    │    │   notifier   │
   │  (agent)     │ ─▶ │   (agent)    │ ─▶ │   (agent)    │
   │  WebSearch + │    │  한국어 요약  │    │  Bash 호출    │
   │  WebFetch    │    │  + 메시지 빌드 │   │              │
   └──────────────┘    └──────────────┘    └──────────────┘
          │                    │                   │
          ▼                    ▼                   ▼
   data/news-           data/message-       node send-telegram.js
   {date}.json          {date}.txt                 │
                        (선택) data/                ▼
                        summary-{date}.json   logs/telegram-
                                              {date}.log
                                                   │
                                                   ▼ (금요일만)
                                       node build-page.js
                                                   │
                                                   ▼
                                       docs/{yr}/week-NN.html
                                       docs/index.html
                                                   │
                                                   ▼
                                           node deploy.js
                                                   │
                                                   ▼
                                            GitHub Pages
```

| 단계 | 실행 주체 | 입력 | 출력 |
|---|---|---|---|
| 1. 수집 | **researcher 에이전트** | (웹) | `data/news-{date}.json` |
| 2. 요약·메시지 빌드 | **updater 에이전트** | news.json | `message-{date}.txt` (+ summary) |
| 3. 전송 | **notifier 에이전트** → `send-telegram.js` | message.txt | `logs/telegram-{date}.log` |
| 4. 빌드 (금) | **`build-page.js`** | summary/news × 5 | `docs/{yr}/week-NN.html` |
| 5. 배포 (금) | **`deploy.js`** | `docs/` 변경 | git push |

**핵심 원칙:**
- 1·2단계는 Claude Code 세션 안의 서브에이전트가 무료로 처리 (외부 LLM API 호출 0회).
- 3·4·5단계는 외부 서비스(Telegram, Git)를 호출하므로 Node 스크립트로 분리.

### 4.2 서비스 구축 파이프라인 (Phase 1 — `/build-service` 스킬)

```
architect ──▶ builder ──▶ validator
                  ▲            │
                  └────────────┘
               (FAIL 시 재호출, 최대 3회)
```

- architect 산출물: `docs/architecture.md` (본 문서)
- builder 산출물: `scripts/*.js`, `package.json`, `.env.example`, `.gitignore`
- validator 산출물: stdout 검증 리포트 (PASS/FAIL)

---

## 5. 에러 처리 전략

### 5.1 에러 분류

| 카테고리 | 예시 | 전략 |
|---|---|---|
| Transient (5xx, 네트워크) | `ETIMEDOUT`, 500 | 지수 백오프 3회 |
| Rate limit | Telegram 429 | `parameters.retry_after` 존중 |
| Parse error | `can't parse entities` | plain text fallback |
| Permanent (4xx) | 401, 404 | 즉시 실패 |
| Data missing | message.txt 없음 | 종료 코드 1, 명확한 에러 메시지 |

### 5.2 재시도 매트릭스

| 호출 | 재시도 | 백오프 |
|---|---|---|
| Telegram `sendMessage` | 3 | 5s 고정 (또는 retry_after) |
| `git pull --rebase` | 3 | 2s × 2^n |
| `git push` | 3 | 2s × 2^n |

### 5.3 폴백 체인

- **MarkdownV2 파싱 실패** → `stripV2()` 후 plain text 재전송.
- **Telegram 3회 실패** → 로그 기록, 다음 메시지 파일은 계속 진행.
- **summary 파일 없음** → news.json의 `keyPoints[0..1]` 사용.
- **Git push 실패** → 로컬 커밋 보존, 다음 실행 시 재시도.

### 5.4 로깅 규약

- `logger.error(scope, message, { stack, context })`.
- 민감 정보(토큰, chat_id 값) 로그 기록 금지 — 키 이름만 출력.
- 각 모듈은 종료 시 결과 객체를 stdout JSON으로 출력.

---

## 6. 환경 변수 (`.env` / `.env.example`)

| 변수 | 필수 | 예시 | 설명 |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Y | `123456:ABC...` | BotFather 발급 토큰 |
| `TELEGRAM_CHAT_ID` | Y | `-100123456789` | 전송 대상 chat/channel ID |
| `GITHUB_REPO_URL` | Y | `https://github.com/u/r.git` | 원격 저장소 URL (검증용) |
| `GIT_USER_NAME` | N | `it-news-bot` | 자동 커밋 사용자명 |
| `GIT_USER_EMAIL` | N | `bot@example.com` | 자동 커밋 이메일 |
| `TZ` | N | `Asia/Seoul` | 런타임 타임존 |
| `LOG_LEVEL` | N | `info` | `debug`/`info`/`warn`/`error` |

> **Anthropic API 키는 필요하지 않습니다.** 뉴스 수집·요약은 Claude Code 세션 안의
> 서브에이전트가 처리하므로 Node 코드에는 LLM 호출이 없습니다.

### `.gitignore` 최소 목록
```
.env
.env.local
data/
logs/
node_modules/
*.log
.DS_Store
```

---

## 7. `package.json`

```json
{
  "name": "it-news-bot-agents",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "send": "node scripts/send-telegram.js",
    "build-page": "node scripts/build-page.js",
    "deploy": "node scripts/deploy.js",
    "check": "node --check scripts/send-telegram.js && node --check scripts/build-page.js && node --check scripts/deploy.js"
  }
}
```

### dependencies (3개)

| 패키지 | 버전 | 용도 |
|---|---|---|
| `node-telegram-bot-api` | `^0.66.0` | Telegram Bot API 클라이언트 |
| `simple-git` | `^3.24.0` | Git 커밋/푸시 |
| `dotenv` | `^16.4.0` | `.env` 로드 |

### 명시적으로 사용하지 않는 것
- `@anthropic-ai/sdk` — LLM 호출이 Node 코드에 없으므로 제거.
- `axios` / `node-fetch` — `node-telegram-bot-api`에 내장 HTTP 사용.
- `cheerio` / `puppeteer` — 웹 검색은 researcher 에이전트(WebSearch/WebFetch) 담당.
- `moment` / `dayjs` — `lib/dateUtils.js`에서 Node 내장 `Intl.DateTimeFormat`만 사용.

---

## 8. 구현 체크리스트 (builder 용)

1. **초기화**
   - [x] `package.json` (§7)
   - [x] `.gitignore` (§6)
   - [x] `.env.example` (§6, placeholder만)
   - [x] `npm install`

2. **디렉토리**
   - [x] `scripts/`, `scripts/lib/`, `data/`, `logs/`, `docs/`, `docs/2026/`
   - [x] `docs/index.html` 초기 스텁 (`<!-- WEEK_LINKS_START/END -->` 마커 포함)

3. **공통 라이브러리**
   - [x] `lib/logger.js`
   - [x] `lib/retry.js`
   - [x] `lib/paths.js`
   - [x] `lib/dateUtils.js`
   - [x] `lib/markdownV2.js`

4. **핵심 모듈**
   - [x] `send-telegram.js` (§2.1)
   - [x] `build-page.js` (§2.2)
   - [x] `deploy.js` (§2.3)

5. **문법 검증**
   - [x] `npm run check` 통과

---

## 9. 참고

- Telegram Bot API: https://core.telegram.org/bots/api
- node-telegram-bot-api: https://github.com/yagop/node-telegram-bot-api
- simple-git: https://www.npmjs.com/package/simple-git
