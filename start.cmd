@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 goto missing_node
if not exist "node_modules\express\package.json" goto missing_build
if not exist "dist\server\src\main.js" goto missing_build
if not exist "client\dist\index.html" goto missing_build
if not defined PORT set "PORT=8000"
echo D2 ROBOCON 2026 - http://localhost:%PORT%
echo Keep this window open. Press Ctrl+C to stop.
node "dist\server\src\main.js"
set "D2_EXIT_CODE=%ERRORLEVEL%"
if not "%D2_EXIT_CODE%"=="0" (
  echo See README.md for troubleshooting. EADDRINUSE means the port is already in use.
  pause
)
exit /b %D2_EXIT_CODE%

:missing_node
echo Node.js 20 or later is required. Node.js 24 LTS is recommended.
echo Install Node.js with npm from https://nodejs.org/en/download
echo Then reopen this window and run setup.cmd first.
pause
exit /b 1

:missing_build
echo Setup or build files are missing. Run setup.cmd first.
echo See README.md for manual setup instructions.
pause
exit /b 1
