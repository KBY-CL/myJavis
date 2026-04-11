---
name: build-service
description: >
  IT 뉴스 자동화 서비스를 처음부터 구축하는 마스터 스킬.
  설계(architect) → 구현(builder) → 검증(validator) 파이프라인을
  순차적으로 실행합니다. 서비스 초기 구축, 전체 재구축이 필요할 때 사용하세요.
disable-model-invocation: true
---

# 서비스 구축 파이프라인 (Phase 1)

이 스킬은 IT 뉴스 자동화 서비스의 전체 코드를 처음부터 구축합니다.
세 개의 서브에이전트를 순차적으로 호출하여 설계 → 구현 → 검증을 수행합니다.

## 실행 순서

### Step 1: 설계

@agent-architect 에게 다음을 요청하세요:

> 이 프로젝트의 CLAUDE.md를 읽고, IT 뉴스 자동화 서비스의 아키텍처를 설계하세요.
> 결과를 docs/architecture.md에 저장하세요.
> 포함할 모듈: collect-news.js, summarize.js, send-telegram.js, build-page.js, deploy.js

설계가 완료되면 `docs/architecture.md`가 생성되었는지 확인합니다.

### Step 2: 구현

@agent-builder 에게 다음을 요청하세요:

> docs/architecture.md를 읽고, 정의된 모든 모듈을 구현하세요.
> package.json, .env.example, .gitignore도 함께 생성하세요.
> npm install까지 완료하세요.

구현이 완료되면 scripts/ 폴더에 모든 .js 파일이 있는지 확인합니다.

### Step 3: 검증

@agent-validator 에게 다음을 요청하세요:

> scripts/ 폴더의 모든 코드를 검증하세요.
> 문법 검사, 의존성 확인, 환경변수 일치, dry-run 테스트를 실행하세요.

### Step 4: 검증 실패 시 재시도

검증 결과가 FAIL이면:

1. validator의 에러 리포트를 읽습니다
2. @agent-builder 에게 에러 리포트와 함께 수정을 요청합니다:
   > 다음 에러를 수정하세요: {에러 리포트 내용}
3. 수정 후 다시 @agent-validator 를 호출합니다
4. 최대 3회 반복합니다

### Step 5: 완료

검증 PASS 시:
- "서비스 구축이 완료되었습니다" 메시지 출력
- 생성된 파일 목록을 나열
- 다음 단계 안내: "텔레그램 봇을 설정하고 .env 파일을 작성한 후, /collect-news로 테스트하세요"

3회 재시도 후에도 FAIL이면:
- 해결하지 못한 에러 목록을 출력
- 사용자에게 수동 개입을 요청
