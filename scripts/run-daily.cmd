@echo off
REM ============================================================
REM IT News Briefing - Daily Pipeline Wrapper for Task Scheduler
REM
REM Runs the /collect-news skill via claude CLI in headless mode,
REM then commits + pushes any docs/ changes to GitHub Pages.
REM
REM Schedule: Mon/Wed/Fri 07:00 KST (via Windows Task Scheduler)
REM
REM This file MUST be saved with CRLF line endings (Windows style).
REM ============================================================

chcp 65001 > nul

REM Move to project root (this script lives in scripts/, project root is one level up).
REM %~dp0 = directory of this script. Trailing backslash already included.
cd /d "%~dp0.."
if errorlevel 1 (
  echo [FATAL] Could not cd to project root 1>&2
  exit /b 1
)

REM Ensure logs directory exists
if not exist "logs" mkdir "logs"

REM Append start marker
>> "logs\task-scheduler.log" (
  echo.
  echo ============================================================
  echo Started at %DATE% %TIME%
  echo ============================================================
)

REM ============================================================
REM Step 1: Run the /collect-news pipeline via claude headless
REM ============================================================
REM
REM --dangerously-skip-permissions is required for cron/headless mode because
REM there is no interactive UI to approve Write/Bash/Edit operations. Without
REM it, all subagent file writes are denied and the pipeline produces empty
REM results.
REM
REM Safe in our case because:
REM   1. Script runs locally on the user's PC (not a sandbox)
REM   2. Prompt is /collect-news, a deterministic project skill
REM   3. No untrusted input - trigger is Task Scheduler only
REM
call "%APPDATA%\npm\claude.cmd" -p "/collect-news" --dangerously-skip-permissions >> "logs\task-scheduler.log" 2>&1
set CLAUDE_EXIT=%ERRORLEVEL%

>> "logs\task-scheduler.log" (
  echo.
  echo ------------------------------------------------------------
  echo claude exited with code %CLAUDE_EXIT% at %DATE% %TIME%
  echo ------------------------------------------------------------
)

REM ============================================================
REM Step 2: Commit and push docs/ changes to GitHub Pages
REM ============================================================
REM
REM We do this in the wrapper (not in the SKILL.md) because:
REM   1. git push needs to happen even if the SKILL doesn't include it
REM   2. Wrapper-level git ops are clearer in logs
REM   3. Failure here doesn't affect the brief itself (already in Telegram)

git config user.name "it-news-bot" >> "logs\task-scheduler.log" 2>&1
git config user.email "bot@kby-cl.github.io" >> "logs\task-scheduler.log" 2>&1

REM Stage only docs/ - never stage data/, logs/, .env
git add docs/ >> "logs\task-scheduler.log" 2>&1

REM Check if there is anything to commit
git diff --cached --quiet
if errorlevel 1 (
  REM There ARE staged changes
  >> "logs\task-scheduler.log" (
    echo.
    echo Staged changes detected, committing and pushing...
  )
  git commit -m "Daily briefing %DATE% (auto)" >> "logs\task-scheduler.log" 2>&1
  git pull --rebase origin main >> "logs\task-scheduler.log" 2>&1
  git push origin main >> "logs\task-scheduler.log" 2>&1
  set GIT_EXIT=%ERRORLEVEL%
  >> "logs\task-scheduler.log" (
    echo git push exited with code %GIT_EXIT%
  )
) else (
  >> "logs\task-scheduler.log" (
    echo.
    echo No docs changes to commit.
  )
  set GIT_EXIT=0
)

REM ============================================================
REM End marker
REM ============================================================
>> "logs\task-scheduler.log" (
  echo.
  echo ============================================================
  echo Finished at %DATE% %TIME%
  echo   claude exit: %CLAUDE_EXIT%
  echo   git exit:    %GIT_EXIT%
  echo ============================================================
)

REM Return claude's exit code (git failure is non-fatal)
exit /b %CLAUDE_EXIT%
