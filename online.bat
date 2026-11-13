@echo off
chcp 65001 >nul
title PromptVault ONLINE (Tailscale / Mobil Erisim)
cd /d "%~dp0"

echo ========================================================
echo   PromptVault ONLINE Versiyonu Baslatiliyor...
echo   (iPhone / iPad / Uzaktan Erisim Modu)
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
:: GitHub Otomatik Guncelleme Kontrolu
where git >nul 2>&1
if errorlevel 1 goto :AFTER_UPDATE_CHECK
if not exist .git goto :AFTER_UPDATE_CHECK

echo [KONTROL] GitHub guncellemeleri denetleniyor...
git fetch origin main >nul 2>&1
git rev-parse HEAD > "%TEMP%\pv_local.txt" 2>nul
git rev-parse origin/main > "%TEMP%\pv_remote.txt" 2>nul

fc "%TEMP%\pv_local.txt" "%TEMP%\pv_remote.txt" >nul 2>&1
if errorlevel 1 (
    echo.
    echo ========================================================
    echo   [GUNCELLEME] GitHub'da yeni bir surum tespit edildi!
    echo   Guncel dosyalar indiriliyor...
    echo ========================================================
    git pull origin main
    .\.venv\Scripts\python.exe -m pip install -e ".[web]" --quiet
    echo   [BASARILI] PromptVault en son surume guncellendi.
    echo.
)
del "%TEMP%\pv_local.txt" "%TEMP%\pv_remote.txt" >nul 2>&1

:AFTER_UPDATE_CHECK
:: 7860 portunu mesgul eden eski bir surec varsa sonlandir
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7860 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: Tailscale & Yerel IP adreslerini tespit et ve goster
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\show_online_urls.ps1" -Port 7860

echo.
echo [BILGI] Tum tarayici sekmeleri (PC + iPhone) kapatildiginda bu terminal otomatik kapanir.
echo [NOT] Eger iPhone'dan baglanacaksaniz PC tarayicisindaki sekmeyi acik tutun veya
echo       iPhone'dan hemen baglanip PC sekmesini oyle kapatin.
echo.

.\.venv\Scripts\python.exe -m promptvault.cli serve --host 0.0.0.0 --open --port 7860
if %ERRORLEVEL% neq 0 (
    echo.
    echo [HATA] Bir sorun olustu, hata detaylari yukaridadir.
    pause
)
