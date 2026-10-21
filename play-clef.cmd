@echo off
rem Opens Clef Crossy Road with Clef-flash playing seed 624140. Press R to replay that map.
rem Like play.cmd, it shows in this terminal what the model is sent (CCR_LOG=brief or off to change that).
setlocal
set "CCR_PLAYER=clef-flash"
set "CCR_SEED=624140"
call "%~dp0play.cmd"
exit /b %errorlevel%
