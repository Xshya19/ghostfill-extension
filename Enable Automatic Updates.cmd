@echo off
setlocal DisableDelayedExpansion
title Enable GhostFill Automatic Updates
set "GHOSTFILL_AUTO_ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%GHOSTFILL_AUTO_ROOT%scripts\setup-auto-updates.ps1" -InstallDirectory "%GHOSTFILL_AUTO_ROOT%."
set "GHOSTFILL_AUTO_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %GHOSTFILL_AUTO_EXIT%
