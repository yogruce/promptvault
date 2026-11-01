@echo off
title PromptVault Team - Calisan (Client)
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Team - CALISAN (CLIENT) SURUMU
echo   Ekip Prompt Kasasi, Gemini Gems ^& Claude Skills
echo ========================================================
echo.

if not exist .venv\Scripts\python.exe goto :no_venv

:: 7862 veya 7861 portunu mesgul eden eski surec varsa sonlandir
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":7862" ^| findstr "LISTENING"') do (
    echo [BILGI] 7862 portunu tutan eski surec PID %%p kapatiliyor...
    taskkill /F /PID %%p >nul 2>&1
)

echo Calisan Kasasi: http://127.0.0.1:7862
echo Tarayici aciliyor...
echo.

.venv\Scripts\python.exe -m promptvault.cli team --open --port 7862
goto :end

:no_venv
echo [HATA] .venv sanal ortami bulunamadi!
echo Lutfen kurulumu tamamlayin.

:end
pause
