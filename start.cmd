@echo off
setlocal
cd /d "%~dp0"
set "D2_NODE=node"
where node >nul 2>&1
if errorlevel 1 set "D2_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "dist\server\src\main.js" (
  echo Build files are missing. Run npm ci and npm run build first.
  pause
  exit /b 1
)
echo D2 ROBOCON 2026 - http://localhost:8000
echo Keep this window open. Press Ctrl+C to stop.
"%D2_NODE%" "dist\server\src\main.js"
if errorlevel 1 pause
