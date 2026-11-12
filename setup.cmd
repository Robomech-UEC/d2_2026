@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto missing_node

echo D2 ROBOCON 2026 - Setup
echo An internet connection is required to download dependencies.
echo [1/2] Installing dependencies...
call npm.cmd ci
if errorlevel 1 goto failed
echo [2/2] Building the application...
call npm.cmd run build
if errorlevel 1 goto failed
echo Setup complete. Double-click start.cmd to start the server.
echo The server has not been started by this setup.
pause
exit /b 0

:missing_node
echo Node.js 20 or later and npm are required. Node.js 24 LTS is recommended.
echo Install Node.js with npm from https://nodejs.org/en/download
echo Then reopen this window and run setup.cmd again.
pause
exit /b 1

:failed
echo Setup failed. Check the error above and the troubleshooting section in README.md.
pause
exit /b 1
