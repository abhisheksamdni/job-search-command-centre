@echo off
setlocal
cd /d "%~dp0"
call npm run doctor
exit /b %errorlevel%
