@echo off
chcp 65001 >nul
title PromptVault Web Arayuzu
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Web Arayuzu Baslatiliyor...
echo ========================================================
echo.

:: Python surumu, .venv sanal ortami ve paketlerin eksiksiz oldugunu dogrula / kur
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup_env.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [HATA] Kurulum veya ortam hazirlama sirasinda bir sorun olustu.
    pause
    exit /b 1
)

:run
:: GitHub Otomatik Guncelleme Kontrolu (git olsun veya olmasin tum PC'lerde calisir)
echo [KONTROL] GitHub guncellemeleri denetleniyor...
.\.venv\Scripts\python.exe -m promptvault.updater --apply
echo.

:AFTER_UPDATE_CHECK
:: 7860 portunu mesgul eden eski bir surec varsa sonlandir
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7860 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo Sunucu adresi (Offline / Yerel): http://127.0.0.1:7860
echo Tarayici aciliyor...
echo [BILGI] Tarayici kapatildiginda bu terminal otomatik olarak kapanacaktir.
echo.

.\.venv\Scripts\python.exe -m promptvault.cli serve --host 127.0.0.1 --open --port 7860
if %ERRORLEVEL% neq 0 (
    echo.
    echo [HATA] Bir sorun olustu, hata detaylari yukaridadir.
    pause
)
