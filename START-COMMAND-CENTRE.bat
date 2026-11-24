@echo off
setlocal
rem Opens the Command Centre dashboard (port 8790). Nothing searches or tailors until you click Search;
rem the JCC search engine (port 8787) is started on demand by the dashboard.
cd /d "%~dp0"

powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:8790/api/state -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c','node --no-warnings _engine\server.mjs >> _engine\dashboard.log 2>&1' -WorkingDirectory '%~dp0Applications' -WindowStyle Hidden"
  powershell -NoProfile -Command "$ok=$false; 1..20 | %% { try { Invoke-RestMethod http://127.0.0.1:8790/api/state -TimeoutSec 2 | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; if(-not $ok){exit 1}"
  if errorlevel 1 (echo Dashboard failed to start. See Applications\_engine\dashboard.log & pause & exit /b 1)
)
start "" http://127.0.0.1:8790
echo Command Centre ready: http://127.0.0.1:8790
exit /b 0
