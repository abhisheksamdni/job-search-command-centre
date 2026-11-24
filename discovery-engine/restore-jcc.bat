@echo off
setlocal
cd /d "%~dp0"
if not exist "..\JCC-Data\Logs" mkdir "..\JCC-Data\Logs"
> "..\JCC-Data\Logs\maintenance.lock" echo restore
if not exist "..\JCC-Data\Backups" (echo ERROR: No backup directory exists.& goto :fail)
echo Existing backups:
for /d %%D in ("..\JCC-Data\Backups\*") do echo   %%~nxD
set /p BACKUP=Type the exact backup folder name to restore: 
if "%BACKUP%"=="" goto :fail
node scripts\restore.mjs --from="%BACKUP%"
if errorlevel 1 goto :fail
call npm run doctor
if errorlevel 1 goto :fail
del /q "..\JCC-Data\Logs\maintenance.lock" >nul 2>nul
exit /b 0
:fail
del /q "..\JCC-Data\Logs\maintenance.lock" >nul 2>nul
exit /b 1
