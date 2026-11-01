@echo off
title PromptVault Team - Yonetici (Admin)
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Team - YONETICI (ADMIN) SURUMU
echo   Gems, Custom GPTs, Skills ^& Kurumsal Drive Yonetimi
echo ========================================================
echo.

if not exist .venv\Scripts\python.exe goto :no_venv

:: 7861 portunu mesgul eden eski surec varsa sonlandir
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":7861" ^| findstr "LISTENING"') do (
    echo [BILGI] 7861 portunu tutan eski surec PID %%p kapatiliyor...
    taskkill /F /PID %%p >nul 2>&1
)

echo Yonetici Paneli: http://127.0.0.1:7861
echo Tarayici aciliyor...
echo.

.venv\Scripts\python.exe -m promptvault.cli team --open --port 7861
goto :end

:no_venv
echo [HATA] .venv sanal ortami bulunamadi!
echo Lutfen kurulumu tamamlayin.

:end
pause
