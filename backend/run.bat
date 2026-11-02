@echo off
REM One-click launcher: install, build, test, then start the server and open the web interface.
REM Logs: run.log (install/build/test) and server.log (server).
cd /d "%~dp0"
echo ==== %date% %time% ==== > run.log

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again. >> run.log
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
node -v >> run.log 2>&1

if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example - add your API key in it. >> run.log
)

echo [1/3] npm install ...
call npm install >> run.log 2>&1
if errorlevel 1 ( echo npm install FAILED - see run.log & echo INSTALL_FAILED >> run.log & pause & exit /b 1 )

echo [2/3] build + tests ...
call npm test >> run.log 2>&1
if errorlevel 1 ( echo build/tests FAILED - see run.log & echo TEST_FAILED >> run.log & pause & exit /b 1 )
echo BUILD_AND_TESTS_OK >> run.log

echo [3/3] starting server on http://localhost:3000 ...
start "" cmd /c "timeout /t 6 >nul & start http://localhost:3000"
echo Server running at http://localhost:3000 - close this window to stop it. Logs: server.log
node dist/main.js > server.log 2>&1
