@echo off
setlocal
set "WORKBENCH_ROOT=%~dp0"
start "AI Game Workbench" "%WORKBENCH_ROOT%tools\launcher\release\AiGameWorkbenchLauncher.exe" %*
