@echo off
setlocal
set "VAULT=%~dp0JCC-Knowledge"
if not exist "%VAULT%" set "VAULT=%~dp0..\JCC-Knowledge"
if not exist "%VAULT%" (
  echo ERROR: JCC-Knowledge vault not found.
  exit /b 1
)
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$p=(Resolve-Path '%VAULT%').Path; [uri]::EscapeDataString($p)"`) do set "VAULT_URI=%%U"
powershell -NoProfile -Command "try { Start-Process ('obsidian://open?path=%VAULT_URI%'); exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Obsidian protocol could not be opened. Opening the vault folder instead.
  start "" "%VAULT%"
  echo Install Obsidian Desktop, open this folder as a vault, then run: Command Palette ^> Open 3D Graph
  exit /b 0
)
echo JCC Knowledge vault opened in Obsidian.
echo For 3D view: Command Palette ^> Open 3D Graph
exit /b 0
