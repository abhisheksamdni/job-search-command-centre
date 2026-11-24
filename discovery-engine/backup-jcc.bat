@echo off
setlocal
cd /d "%~dp0"
if not exist "..\JCC-Data\Logs" mkdir "..\JCC-Data\Logs"
> "..\JCC-Data\Logs\maintenance.lock" echo backup
call npm run backup
set "RC=%ERRORLEVEL%"
del /q "..\JCC-Data\Logs\maintenance.lock" >nul 2>nul
exit /b %RC%
