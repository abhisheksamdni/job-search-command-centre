@echo off
setlocal
cd /d "%~dp0"
node scripts\stop.mjs
exit /b %errorlevel%
