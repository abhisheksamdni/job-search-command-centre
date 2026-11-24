@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules\playwright\package.json (
  echo ERROR: Required dependencies are missing or incomplete.
  echo Run "%~dp0install.bat", then try again.
  exit /b 1
)
if not exist "..\JCC-Data\Logs" mkdir "..\JCC-Data\Logs"
if exist "..\JCC-Data\Logs\intentional-stop.marker" del /q "..\JCC-Data\Logs\intentional-stop.marker" >nul 2>nul

powershell -NoProfile -Command "try { $r=Invoke-RestMethod http://127.0.0.1:8787/api/health -TimeoutSec 2; if($r.version -like '2.0.0-alpha.4*'){exit 0}else{exit 2} } catch { exit 1 }"
set "HEALTH_RC=%ERRORLEVEL%"
if %HEALTH_RC% EQU 0 (
  call :startwatchdog
  start "" http://127.0.0.1:8787
  echo JCC LOCAL is already running.
  exit /b 0
)
if %HEALTH_RC% EQU 2 (
  echo ERROR: Port 8787 is serving an unexpected process/JCC version. Nothing was started.
  exit /b 2
)

powershell -NoProfile -Command "$wd=(Get-Location).Path; $cmd='node src\server.mjs >> ..\JCC-Data\Logs\server.log 2>&1'; Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',$cmd -WorkingDirectory $wd -WindowStyle Hidden"
if errorlevel 1 (echo ERROR: Could not launch JCC server process.& exit /b 1)
powershell -NoProfile -Command "$ok=$false; 1..40 | %% { try { $r=Invoke-RestMethod http://127.0.0.1:8787/api/health -TimeoutSec 2; if($r.version -like '2.0.0-alpha.4*'){$ok=$true; break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ok){exit 1}"
if errorlevel 1 (
  echo ERROR: JCC failed to start. See "%~dp0..\JCC-Data\Logs\server.log"
  exit /b 1
)
call :startwatchdog
start "" http://127.0.0.1:8787
echo JCC LOCAL READY
echo http://127.0.0.1:8787
exit /b 0

:startwatchdog
powershell -NoProfile -Command "$wd=(Get-Location).Path; Start-Process -FilePath 'node.exe' -ArgumentList 'scripts\watchdog.mjs' -WorkingDirectory $wd -WindowStyle Hidden" >nul 2>nul
exit /b 0
