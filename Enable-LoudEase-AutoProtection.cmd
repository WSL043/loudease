@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\enable_auto_protection.ps1" %*
set "LOUD_EASE_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %LOUD_EASE_EXIT%
