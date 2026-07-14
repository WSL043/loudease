@echo off
setlocal

if not defined NODE_EXE (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js 20 or newer is required. Add node to PATH or set NODE_EXE.
    exit /b 1
  )
  set "NODE_EXE=node"
)

if /I "%~1"=="--slider" (
  "%NODE_EXE%" "%~dp0e2e_slider_persistence.js"
) else (
  "%NODE_EXE%" "%~dp0run_all_checks.js"
)

exit /b %ERRORLEVEL%
