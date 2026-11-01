@echo off
chcp 65001 >nul
title PromptVault Team Edition
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Team Edition (ChatGPT, Gemini, Claude)
echo   Gems, Custom GPTs, Skills ^& Kurumsal Drive Sync
echo ========================================================
echo.

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
:: 7861 portunu mesgul eden eski bir surec varsa sonlandir
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":7861" ^| findstr "LISTENING"') do (
    echo [BILGI] 7861 portunu tutan eski surec PID %%p kapatiliyor...
    taskkill /F /PID %%p >nul 2>&1
)

echo Sunucu baslatiliyor (Port 7861)...
echo Tarayici aciliyor: http://127.0.0.1:7861
echo.
.\.venv\Scripts\promptvault team --port 7861 --open

pause
