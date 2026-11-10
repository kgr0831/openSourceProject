@echo off
start "" powershell.exe -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0lms-parser\start-ui.ps1"
exit /b 0
