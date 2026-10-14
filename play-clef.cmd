@echo off
rem Opens Clef Crossy Road with Clef-flash playing seed 1. That map was already played by the benchmark,
rem so its decisions come from the local cache and cost no neurons. Press M for the next cached map.
setlocal
set "EXE=%~dp0apps\desktop\src-tauri\target\release\clef-crossy-road.exe"
set "CCR_PLAYER=clef"
set "CCR_SEED=1"

if not exist "%EXE%" (
  echo The release build was not found. Run play.cmd for build instructions.
  pause
  exit /b 1
)

start "" "%EXE%"
