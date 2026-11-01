@echo off
title PromptVault Team Edition
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Team Edition Baslatiliyor...
echo   ChatGPT, Gemini, Claude, Gems ^& Kurumsal Drive
echo ========================================================
echo.

if not exist .venv\Scripts\python.exe goto :no_venv

:: 7861 portunu mesgul eden eski surec varsa sonlandir
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":7861" ^| findstr "LISTENING"') do (
    echo [BILGI] 7861 portunu tutan eski surec PID %%p kapatiliyor...
    taskkill /F /PID %%p >nul 2>&1
)

echo Sunucu adresi: http://127.0.0.1:7861
echo Tarayici aciliyor...
echo Kapatmak icin pencereyi kapatabilir veya Ctrl+C yapabilirsiniz.
echo.

.venv\Scripts\python.exe -m promptvault.cli team --open --port 7861
goto :end

:no_venv
echo [HATA] .venv sanal ortami bulunamadi!
echo Lutfen kurulumu tamamlayin.

:end
pause
