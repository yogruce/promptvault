@echo off
chcp 65001 >nul
title PromptVault Team Edition

echo ========================================================
echo   PromptVault Team Edition (ChatGPT, Gemini, Claude)
echo   Gems, Custom GPTs, Skills & Kurumsal Drive Sync
echo ========================================================
echo.

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [HATA] Sanal ortam (.venv) bulunamadi!
    pause
    exit /b 1
)

echo Sunucu baslatiliyor (Port 7861)...
echo Tarayici aciliyor: http://127.0.0.1:7861
echo.
.\.venv\Scripts\promptvault team --port 7861 --open

pause
