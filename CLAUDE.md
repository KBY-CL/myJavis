# IT 뉴스 자동화 봇

## 프로젝트 개요
매일 아침 8시에 AI/Claude/IT/웹개발 뉴스를 수집하여 텔레그램으로 전송하고,
주간 아카이브를 GitHub Pages에 배포하는 자동화 서비스입니다.

## 에이전트 아키텍처
이 프로젝트는 멀티 에이전트 파이프라인으로 동작합니다.
마스터(사용자 또는 스킬)가 서브에이전트를 순차 호출하고, 파일 경로를 통해 데이터를 전달합니다.

### Phase 1 — 서비스 구축: /build-service
architect → builder → validator (실패 시 builder 재호출)

### Phase 2 — 일일 운영: /collect-news
researcher → updater → notifier (실패 시 notifier 재호출)

## 에이전트 목록 및 도구 권한
| 에이전트     | 모델   | 도구                              | 역할               |
|-------------|--------|----------------------------------|-------------------|
| architect   | opus   | Read, Glob, Grep, WebSearch       | 설계 전문 (Read-only) |
| builder     | sonnet | Read, Write, Edit, Bash, Glob     | 코드 구현           |
| validator   | sonnet | Read, Bash, Glob, Grep            | 테스트 검증          |
| researcher  | sonnet | Read, Write, Bash, WebSearch, WebFetch | 뉴스 수집       |
| updater     | sonnet | Read, Write, Edit, Bash, Glob     | 요약 + 웹페이지 빌드  |
| notifier    | haiku  | Read, Bash                        | 텔레그램 전송        |

## 핸드오프 규칙
각 에이전트는 파일 경로를 통해 데이터를 주고받습니다.
- architect 출력 → `docs/architecture.md`
- builder 출력 → `scripts/*.js`, `package.json`
- validator 출력 → stdout (테스트 결과)
- researcher 출력 → `data/news-YYYY-MM-DD.json`
- updater 출력 → `data/message-YYYY-MM-DD.txt`, `docs/2026/week-NN.html`
- notifier 출력 → `logs/telegram-YYYY-MM-DD.log`

## 핵심 규칙
- 모든 뉴스 요약은 한국어로 작성
- 각 뉴스 항목은 3줄 이내로 요약
- 원문 URL은 반드시 포함
- .env 파일은 절대 커밋하지 않기
- data/, logs/ 폴더는 gitignore 대상

## 기술 스택
- Node.js + @anthropic-ai/sdk
- Telegram Bot API (node-telegram-bot-api)
- GitHub Pages (docs/ 폴더)
- simple-git (자동 커밋/푸시)

## 환경 변수 (.env)
- ANTHROPIC_API_KEY
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- GITHUB_REPO_URL
