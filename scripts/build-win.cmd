@echo off
REM ============================================================
REM  Windows one-click packaging script (v3 P4, recommended)
REM  Usage: from repo root run  scripts\build-win.cmd
REM  ASCII-only to survive GBK cmd.exe terminals.
REM ============================================================

setlocal
cd /d "%~dp0\.."

echo [1/4] Type check...
call npx tsc -p tsconfig.node.json --noEmit || goto :step_fail
call npx tsc -p tsconfig.web.json --noEmit || goto :step_fail

echo [2/4] electron-vite build...
call npx electron-vite build || goto :step_fail

echo [3/4] electron-builder (Windows NSIS + zip)...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win nsis || goto :step_fail

echo [4/4] Done. Artifacts in release\:
dir /b release\*.exe 2>nul
echo.
echo Installer : release\WriterAssistant-Setup-1.3.0-x64.exe
echo Portable  : release\WriterAssistant-1.3.0-x64.exe
exit /b 0

:step_fail
echo [FAIL] Step failed, exit code %ERRORLEVEL%
exit /b 1