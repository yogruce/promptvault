@echo off
chcp 65001 >nul
title PromptVault Team Edition
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Team Edition (ChatGPT, Gemini, Claude)
echo   Gems, Custom GPTs, Skills ^& Kurumsal Drive Sync
echo ========================================================
echo.

:: 7861 portunu mesgul eden eski surec varsa kesinlikle kapat
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7861 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

if exist .venv\Scripts\python.exe goto :run

echo [BILGI] .venv sanal ortami bulunamadi, otomatik kuruluyor...
echo Lutfen bekleyin, ilk kurulum 1-2 dakika surebilir...
echo.

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [HATA] Bilgisayarinizda Python kurulu degil!
    echo Lutfen https://www.python.org/downloads/ adresinden Python'i indirin
    echo ve kurarken "Add Python to PATH" kutucugunu isaretleyin.
    pause
    exit /b 1
)

python -m venv .venv
if not exist .venv\Scripts\python.exe (
    echo [HATA] .venv olusturulamadi!
    pause
    exit /b 1
)

echo [BILGI] Gerekli paketler yukleniyor...
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\pip install -e ".[web]"
echo [BASARILI] Kurulum tamamlandi!
echo.

:run
echo Sunucu baslatiliyor (Port 7861)...
echo Tarayici aciliyor: http://127.0.0.1:7861
echo.
.\.venv\Scripts\promptvault team --port 7861 --open

pause
