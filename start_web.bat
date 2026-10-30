@echo off
title PromptVault Web Arayuzu
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Web Arayuzu Baslatiliyor...
echo ========================================================
echo.

if not exist .venv\Scripts\python.exe goto :no_venv

:: 7860 portunu mesgul eden eski bir surec varsa sonlandir
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":7860" ^| findstr "LISTENING"') do (
    echo [BILGI] 7860 portunu tutan eski surec PID %%p kapatiliyor...
    taskkill /F /PID %%p >nul 2>&1
)

echo Sunucu adresi: http://127.0.0.1:7860
echo Tarayici aciliyor...
echo Kapatmak icin pencereyi kapatabilir veya Ctrl+C yapabilirsiniz.
echo.

.venv\Scripts\python.exe -m promptvault.cli serve --open --port 7860
goto :end

:no_venv
echo [HATA] .venv sanal ortami bulunamadi.

:end
pause
