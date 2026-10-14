@echo off
rem Opens Clef Crossy Road (the release build). Double-click this file, or run it from a terminal.
setlocal
set "EXE=%~dp0apps\desktop\src-tauri\target\release\clef-crossy-road.exe"

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

start "" "%EXE%"
