@echo off
title Muxu Agent Launcher
chcp 65001 >nul 2>&1
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "NODE_EXE=C:\Users\ThinkPad\.workbuddy\binaries\node\versions\22.22.2\node.exe"

echo ========================================
echo   Muxu Agent Launcher
echo ========================================
echo.

if not exist "%NODE_EXE%" (
  echo [ERROR] Node not found at:
  echo   %NODE_EXE%
  echo Install from https://nodejs.org/
  pause
  exit /b 1
)
echo [OK] Node found

netstat -ano | findstr ":8088 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
  echo [1/3] Port 8088 in use, assume proxy already running
) else (
  echo [1/3] Starting proxy on port 8088...
  start "proxy-8088" /min cmd /c "cd /d %ROOT% && %NODE_EXE% proxy-example.js"
  timeout /t 2 >nul
)

netstat -ano | findstr ":8000 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
  echo [2/3] Port 8000 in use, killing old process...
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
  )
  timeout /t 1 >nul
)

echo [2/3] Starting page server on port 8000...
start "page-8000" /min cmd /c "cd /d %ROOT% && %NODE_EXE% static-server.js"
timeout /t 3 >nul

curl -s -o nul -w "" --max-time 3 "http://localhost:8088/health" >nul 2>&1
if errorlevel 1 (
  echo [WARN] Proxy not responding on 8088
) else (
  echo [3/3] Proxy OK
)

echo.
echo ========================================
echo   Page:   http://localhost:8000/index.html
echo   Proxy:  http://localhost:8088/?url=
echo.
echo   In the page, set proxy URL to:
echo     http://localhost:8088/?url=
echo.
echo   Do NOT close the black windows!
echo ========================================
echo.

start "" "http://localhost:8000/index.html"

pause
