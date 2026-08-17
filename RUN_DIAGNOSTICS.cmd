@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostics\start-diagnostics.ps1"
if errorlevel 1 pause
endlocal
