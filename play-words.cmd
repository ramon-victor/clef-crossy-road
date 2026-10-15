@echo off
rem Opens Clef Crossy Road with Clef-flash plus words and a controller, the condition of ADR-0010 that made the
rem most rows (10.05 over 40 games), on seed 10 (one of its best maps: 45 rows). Seeds 1 to 40 were played by the
rem benchmark, so their decisions come from the local cache and cost no neurons. Press M for the next cached map.
rem Like play.cmd, it shows in this terminal what the model is sent (CCR_LOG=brief or off to change that).
setlocal
set "CCR_PLAYER=clef-words"
set "CCR_SEED=10"
call "%~dp0play.cmd"
exit /b %errorlevel%
