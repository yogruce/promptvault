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
:: GitHub Otomatik Guncelleme Kontrolu (Git varsa)
where git >nul 2>&1
if %ERRORLEVEL% equ 0 (
    if exist .git (
        echo [KONTROL] GitHub guncellemeleri denetleniyor...
        git fetch origin main >nul 2>&1
        set PV_LOCAL=
        set PV_REMOTE=
        for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set PV_LOCAL=%%i
        for /f "tokens=*" %%i in ('git rev-parse origin/main 2^>nul') do set PV_REMOTE=%%i
        if not "%PV_LOCAL%"=="" if not "%PV_REMOTE%"=="" (
            if not "%PV_LOCAL%"=="%PV_REMOTE%" (
                echo.
                echo ========================================================
                echo   [GUNCELLEME] GitHub'da yeni bir surum tespit edildi!
                echo   Guncel dosyalar indiriliyor (git pull)...
                echo ========================================================
                git pull origin main
                .\.venv\Scripts\pip install -e ".[web]" --no-deps --quiet
                echo   [BASARILI] PromptVault en son surume guncellendi.
                echo.
            )
        )
    )
)

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
