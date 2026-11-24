@echo off
setlocal
cd /d "%~dp0"
if not exist "..\JCC-Data\Logs" mkdir "..\JCC-Data\Logs"
> "..\JCC-Data\Logs\maintenance.lock" echo install
where node >nul 2>nul || (echo ERROR: Node.js 22+ is required.& goto :fail)
for /f "tokens=*" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (echo ERROR: Node.js 22+ is required. Found major version %NODEMAJOR%.& goto :fail)
where npm >nul 2>nul || (echo ERROR: npm is required.& goto :fail)

echo [1/6] Installing pinned JCC dependencies...
if exist package-lock.json (
  call npm ci || goto :fail
) else (
  call npm install --no-package-lock || goto :fail
)
echo [2/6] Installing Playwright Chromium...
call npx playwright install chromium || goto :fail
echo [3/6] Initializing private data, SQLite and knowledge graph...
call npm run init:local || goto :fail
echo [4/6] Running Doctor...
call npm run doctor || goto :fail
echo [5/6] Running full regression suite...
call npm test || goto :fail
echo [6/6] Verifying generated graph index...
if not exist "..\JCC-Data\graph\graph-index.json" (echo ERROR: graph-index.json was not generated.& goto :fail)
del /q "..\JCC-Data\Logs\maintenance.lock" >nul 2>nul
echo.
echo JCC LOCAL INSTALL COMPLETE
echo Run start-jcc.bat to launch http://127.0.0.1:8787
exit /b 0

:fail
del /q "..\JCC-Data\Logs\maintenance.lock" >nul 2>nul
exit /b 1
