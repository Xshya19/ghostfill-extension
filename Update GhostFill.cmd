@echo off
setlocal DisableDelayedExpansion
title Update GhostFill
set "GHOSTFILL_UPDATE_ROOT=%~dp0"
set "GHOSTFILL_UPDATE_PACKAGE=%~f1"
pushd "%GHOSTFILL_UPDATE_ROOT%.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%GHOSTFILL_UPDATE_ROOT%scripts\update-extension.ps1" -InstallDirectory "%GHOSTFILL_UPDATE_ROOT%." -PackagePath "%GHOSTFILL_UPDATE_PACKAGE%"
set "GHOSTFILL_UPDATE_EXIT=%ERRORLEVEL%"
popd
echo.
pause
exit /b %GHOSTFILL_UPDATE_EXIT%
