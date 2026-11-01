@echo off
chcp 65001 >nul
title PromptVault Web Arayuzu
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Web Arayuzu Baslatiliyor...
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
:: 7860 portunu mesgul eden eski bir surec varsa sonlandir
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":7860" ^| findstr "LISTENING"') do (
    echo [BILGI] 7860 portunu tutan eski surec PID %%p kapatiliyor...
    taskkill /F /PID %%p >nul 2>&1
)

echo Sunucu adresi: http://127.0.0.1:7860
echo Tarayici aciliyor...
echo Kapatmak icin pencereyi kapatabilir veya Ctrl+C yapabilirsiniz.
echo.

.\.venv\Scripts\python.exe -m promptvault.cli serve --open --port 7860
pause
