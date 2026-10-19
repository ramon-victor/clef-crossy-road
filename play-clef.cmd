@echo off
rem Opens Clef Crossy Road with Clef-flash playing seed 7. That map was already played by the benchmark,
rem so its decisions come from the local cache and cost no neurons. Press R to replay that map.
rem Like play.cmd, it shows in this terminal what the model is sent (CCR_LOG=brief or off to change that).
setlocal
set "CCR_PLAYER=clef-flash"
set "CCR_SEED=7"
call "%~dp0play.cmd"
exit /b %errorlevel%
