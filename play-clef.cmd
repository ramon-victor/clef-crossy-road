@echo off
rem Opens Clef Crossy Road with Clef-flash playing seed 1. That map was already played by the benchmark,
rem so its decisions come from the local cache and cost no neurons. Press M for the next cached map.
rem Like play.cmd, it shows in this terminal what the model is sent (CCR_LOG=brief or off to change that).
setlocal
set "CCR_PLAYER=clef-flash"
set "CCR_SEED=1"
call "%~dp0play.cmd"
exit /b %errorlevel%
