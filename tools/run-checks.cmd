@echo off
setlocal

where node >nul 2>nul
if errorlevel 1 (
  set "NODE_EXE=C:\Users\Omo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
) else (
  set "NODE_EXE=node"
)

if /I "%~1"=="--slider" (
  "%NODE_EXE%" "%~dp0e2e_slider_persistence.js"
) else (
  "%NODE_EXE%" "%~dp0run_all_checks.js"
)

exit /b %ERRORLEVEL%
