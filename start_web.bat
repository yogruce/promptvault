@echo off
cd /d "%~dp0"

echo ========================================================
echo   PromptVault Web Arayuzu Baslatiliyor...
echo ========================================================
echo.

if not exist .venv\Scripts\python.exe goto :no_venv

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
