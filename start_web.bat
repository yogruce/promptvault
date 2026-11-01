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
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7860 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo Sunucu adresi: http://127.0.0.1:7860
echo Tarayici aciliyor...
echo [BILGI] Tarayici kapatildiginda bu terminal otomatik olarak kapanacaktir.
echo.

.\.venv\Scripts\python.exe -m promptvault.cli serve --open --port 7860
if %ERRORLEVEL% neq 0 (
    echo.
    echo [HATA] Bir sorun olustu, hata detaylari yukaridadir.
    pause
)
