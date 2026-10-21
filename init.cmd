@echo off
rem Sets up Clef Crossy Road on Windows:  init.cmd [--desktop] [--yes]
rem scripts\init.mjs does the work; this file only makes sure Node.js is there to run it.
setlocal
where node >nul 2>&1
if errorlevel 1 (
  echo [!!] Node.js was not found. Install Node 24 or newer from https://nodejs.org, then run init.cmd again.
  exit /b 1
)
node "%~dp0scripts\init.mjs" %*
exit /b %errorlevel%
