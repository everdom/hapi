@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0update-global-hapi.ps1" %*
exit /b %ERRORLEVEL%
