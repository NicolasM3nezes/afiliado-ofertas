@echo off
setlocal
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo PowerShell nao encontrado.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local.ps1"

if errorlevel 1 (
  echo.
  echo O ambiente encerrou com erro. Revise a mensagem acima.
  pause
)
