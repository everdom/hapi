@echo off
chcp 65001 >nul
echo ========================================
echo   HAPI - 验证 reasoning 修复
echo   端口: Hub=3107  Web=5180
echo ========================================
echo.

:: ========== 1. 启动 Hub（独立端口 + 独立数据目录）==========
echo [1/2] 启动 Hub on :3107 ...
set HAPI_LISTEN_PORT=3107
set HAPI_HOME=%TEMP%\hapi-test-3107
set HAPI_PUBLIC_URL=http://localhost:3107

start "hapi-hub-3107" /B /MIN cmd /c "bun run src\index.ts" --cwd hub

:: 等 hub 就绪
:wait_hub
timeout /t 1 /nobreak >nul
netstat -ano 2>nul | findstr ":3107" | findstr "LISTENING" >nul
if errorlevel 1 goto wait_hub
echo   ✓ Hub 已就绪 (http://localhost:3107)

:: ========== 2. 启动 Web Dev Server ==========
echo [2/2] 启动 Web on :5180 ...
set VITE_HUB_PROXY=http://127.0.0.1:3107
start "hapi-web-5180" /B /MIN cmd /c "bun run dev --port 5180" --cwd web

:: 等 web 就绪
:wait_web
timeout /t 1 /nobreak >nul
netstat -ano 2>nul | findstr ":5180" | findstr "LISTENING" >nul
if errorlevel 1 goto wait_web
echo   ✓ Web 已就绪 (http://localhost:5180)

echo.
echo ========================================
echo   ✨ 全部就绪！浏览器打开:
echo      http://localhost:5180
echo.
echo   完成后关闭服务：
echo      taskkill //F //IM bun.exe
echo ========================================
pause
