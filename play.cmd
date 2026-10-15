@echo off
rem Opens Clef Crossy Road (the release build) and shows, in this terminal, what the model is sent.
rem Double-click this file, or run it from a terminal:  .\play.cmd
rem
rem   CCR_LOG=full    (the default here) the state and the answer of every decision, and the question
rem                   and options once per game. The same lines go to runs\logs\play.log
rem   CCR_LOG=brief   one line per decision
rem   CCR_LOG=off     nothing
rem   CCR_PLAYER=clef-flash ^| clef-27b ^| lookahead ^| clef:clef-flash:view-fx:choice:routing ...
rem   CCR_SEED=1
setlocal
set "EXE=%~dp0apps\desktop\src-tauri\target\release\clef-crossy-road.exe"
if not defined CCR_LOG set "CCR_LOG=full"

if not exist "%EXE%" (
  echo The release build was not found. Build it once with:
  echo.
  echo   pnpm install
  echo   node scripts\fetch-assets.mjs
  echo   pnpm --filter @ccr/desktop build
  echo   cd apps\desktop ^&^& pnpm tauri build --no-bundle
  echo.
  pause
  exit /b 1
)

where powershell >nul 2>&1
if errorlevel 1 (
  start "" "%EXE%"
  exit /b 0
)

rem A window app does not wait for itself and its output goes nowhere. Piping it through PowerShell makes
rem this script wait until the window closes and puts what the app prints in this terminal.
powershell -NoProfile -Command "& $env:EXE | Out-Host"
exit /b %errorlevel%
