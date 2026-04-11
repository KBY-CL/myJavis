---
name: collect-news
description: >
  매일 아침 IT 뉴스를 병렬로 수집하여 텔레그램 전송 + 개인 웹페이지를 생성하는 마스터 스킬.
  4개 카테고리 researcher를 병렬 실행 → aggregator → formatter → updater → notifier
  파이프라인을 순차적으로 실행합니다.
  뉴스 수집, 브리핑 전송, 일간/주간 아카이브가 필요할 때 사용하세요.
disable-model-invocation: true
---

# 일일 뉴스 수집 파이프라인 (Phase 2)

매일 아침 자동으로 IT 뉴스를 수집하고 텔레그램으로 전송한 뒤, 개인 웹페이지
(`docs/daily/{date}.html`)를 빌드합니다. 금요일에는 추가로 주간 아카이브와
GitHub Pages 배포를 수행합니다.

## 핵심 특징

- **병렬 수집**: **5개**의 카테고리별 researcher가 동시에 실행되어 단일 researcher
  대비 수집 시간이 크게 단축됩니다.
- **외부 LLM API 0회**: 뉴스 수집·요약은 모두 Claude Code 세션 안의 서브에이전트가
  처리합니다. `.env`에는 Telegram 관련 키만 필요합니다.
- **최대 10건**: formatter가 relevanceScore 기준으로 상위 10건을 선별해 정보
  과잉을 방지합니다 (5 카테고리 × 평균 2건).
- **개인 웹페이지**: 매일 `docs/daily/{date}.html` 이 생성되며, `docs/index.html`
  이 최신 일간 + 주간 아카이브 목록을 보여줍니다.

## 사전 확인

실행 전 다음을 확인합니다:
1. `.env` 파일이 존재하는지
2. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`가 설정되어 있는지
3. `scripts/send-telegram.js`, `scripts/build-page.js`가 존재하는지

하나라도 누락되면 에러를 보고하고 중단합니다.

> 참고: 이 파이프라인은 외부 LLM API를 호출하지 않습니다. 뉴스 수집과 한국어
> 요약은 모두 Claude Code 세션 안의 서브에이전트가 처리합니다.

## 실행 순서

### Step 0: 진행 상황 안내

수집을 시작하기 전에 사용자에게 5개 카테고리가 병렬로 수집될 것임을 알립니다:

```
병렬 수집 시작 (오늘: {YYYY-MM-DD} {요일})
  - [researcher-ai]      🤖 AI 뉴스 수집 중 (목표: 2~3건)
  - [researcher-claude]  🟠 Claude 업데이트 수집 중 (목표: 2~3건)
  - [researcher-it]      🔥 IT 핫이슈 수집 중 (목표: 2~3건)
  - [researcher-webdev]  💻 웹개발 뉴스 수집 중 (목표: 2~3건)
  - [researcher-aws]     ☁️ AWS 클라우드 수집 중 (목표: 1~2건)
총 10건 이하로 제한됩니다.
```

### Step 1: 병렬 뉴스 수집

**반드시 한 번의 응답 안에서 5개 Agent 툴 호출을 동시에** 실행합니다
(병렬 처리의 핵심). 각 researcher는 자기 카테고리만 수집합니다.

- `@agent-researcher-ai` → `data/news-ai-{date}.json` (최대 3건)
- `@agent-researcher-claude` → `data/news-claude-{date}.json` (최대 3건)
- `@agent-researcher-it` → `data/news-it-{date}.json` (최대 3건)
- `@agent-researcher-webdev` → `data/news-webdev-{date}.json` (최대 3건)
- `@agent-researcher-aws` → `data/news-aws-{date}.json` (최대 2건)

5개 모두 완료되기를 기다린 뒤 각 JSON 파일이 생성되었는지 확인합니다.
하나라도 실패하면 사용자에게 보고하되 파이프라인은 나머지로 계속 진행할 수 있습니다.

### Step 2: 통합 (aggregator)

@agent-aggregator 에게 다음을 요청:

> `data/news-ai-{date}.json`, `data/news-claude-{date}.json`,
> `data/news-it-{date}.json`, `data/news-webdev-{date}.json`,
> `data/news-aws-{date}.json` **5개 파일**을 `data/news-{date}.json` 하나로 병합하세요.

결과 확인: `data/news-{date}.json` 이 존재하며 totalArticles 가 합계와 일치.

### Step 3: 정규화 + 상위 10건 선별 (formatter)

@agent-formatter 에게 다음을 요청:

> `data/news-{date}.json` 을 읽어 relevanceScore 상위 10건을 카테고리 균형 있게
> 선별한 뒤 `data/formatted-{date}.json` 을 생성하세요.

결과 확인: totalSelected ≤ 10, 각 카테고리에 최소 1건 (원본에 있었다면).

### Step 4: 한국어 요약 + 메시지 + 일간 페이지 빌드 (updater)

오늘의 요일을 계산합니다 (월~일).

@agent-updater 에게 다음을 요청:

> `data/formatted-{date}.json` 을 읽어 한국어 요약을 작성하고
> `data/daily-{date}.json` 과 `data/message-{date}.txt` 를 생성하세요.
> 그 뒤 `node scripts/build-page.js --mode=daily --date={date}` 를 실행하여
> 일간 웹페이지를 빌드하세요.
>
> 오늘은 {요일}입니다. {금요일이면: 추가로 `--mode=both` 로 주간 아카이브까지
> 빌드하고 `node scripts/deploy.js --date={date}` 로 GitHub Pages에 배포하세요.}

결과 확인:
- `data/daily-{date}.json` 유효한 JSON
- `data/message-{date}.txt` 존재, 4096자 이하
- `docs/daily/{date}.html` 존재
- `docs/index.html` 업데이트됨

### Step 5: 텔레그램 전송 (notifier)

@agent-notifier 에게 다음을 요청:

> `data/message-{date}.txt` 를 `node scripts/send-telegram.js --date={date}` 로
> 전송하고 로그 결과를 보고하세요.

### Step 6: 전송 실패 시 재시도

notifier가 실패를 보고하면:
1. 에러 로그(`logs/telegram-{date}.log`) 확인
2. MarkdownV2 파싱 에러인 경우 → @agent-updater 에게 이스케이프 수정 요청
3. 네트워크/인증 에러인 경우 → @agent-notifier 재호출 (최대 3회)

### Step 7: 요약 보고

사용자에게 최종 결과를 보고합니다:

```
✅ 일일 뉴스 브리핑 완료 · {YYYY-MM-DD} {요일}

수집: {n}건 (ai {n1}, claude {n2}, it {n3}, webdev {n4}, aws {n5})
텔레그램: message_id={id} (fallback={true|false})
일간 페이지: docs/daily/{date}.html
{금요일인 경우: 주간 아카이브: docs/{year}/week-{NN}.html, 배포: {commitSha}}

실행 시간: {mm:ss}
```

## 스케줄링

이 스킬은 다음 방법으로 자동 실행됩니다:
- Claude Desktop: 사이드바 Schedule → 매일 08:00
- Windows Task Scheduler: `claude -p "/collect-news"`
- 수동 실행: Claude Code CLI에서 `/collect-news` 입력

## 데이터 흐름 요약

```
[parallel ×5]                 [sequential]
  researcher-ai                 aggregator → formatter → updater → notifier
  researcher-claude                                         ↓
  researcher-it                               build-page.js (--mode=daily)
  researcher-webdev                                         ↓
  researcher-aws                              docs/daily/{date}.html
         ↓                                    docs/index.html
  data/news-{cat}-{date}.json                              ↓
                                           (금) --mode=both + deploy.js
                                                          ↓
                                               GitHub Pages
```
