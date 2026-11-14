@echo off
chcp 65001 >nul
title PromptVault GitHub Guncelleyici
cd /d "%~dp0"

echo ========================================================
echo   PromptVault - Yerinde GitHub Guncelleyici
echo   (Veritabani, kasa, .venv ve Drive ayarlari korunur)
echo ========================================================
echo.

:: Calisan eski PromptVault sunucusu varsa kapat
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7860 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: GitHub'dan en guncel main arsivini indir ve sadece kod/betik dosyalarini uzerine yaz
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; " ^
  "$repo = 'yogruce/promptvault'; $branch = 'main'; " ^
  "$tmp = Join-Path $env:TEMP ('pv_upd_' + [guid]::NewGuid().ToString('N').Substring(0,8)); " ^
  "$zip = Join-Path $tmp 'src.zip'; " ^
  "New-Item -ItemType Directory -Path $tmp -Force | Out-Null; " ^
  "try { " ^
  "  Write-Host '[1/3] GitHub surum bilgisi aliniyor...' -ForegroundColor Cyan; " ^
  "  $hdr = @{ 'User-Agent' = 'PromptVault-Updater/1.0' }; " ^
  "  $commit = Invoke-RestMethod -Uri \"https://api.github.com/repos/$repo/commits/$branch\" -Headers $hdr -TimeoutSec 10; " ^
  "  Write-Host ('      Son commit: ' + $commit.sha.Substring(0,7) + ' - ' + ($commit.commit.message -split \"`n\")[0]); " ^
  "  Write-Host '[2/3] Guncel dosyalar GitHub''dan indiriliyor...' -ForegroundColor Cyan; " ^
  "  Invoke-WebRequest -Uri \"https://github.com/$repo/archive/refs/heads/$branch.zip\" -Headers $hdr -OutFile $zip -TimeoutSec 60; " ^
  "  Expand-Archive -Path $zip -DestinationPath $tmp -Force; " ^
  "  $srcRoot = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1; " ^
  "  if (-not $srcRoot) { throw 'Indirilen arsiv acilamadi.' }; " ^
  "  Write-Host '[3/3] Kod dosyalari yerinde guncelleniyor (veriler korunuyor)...' -ForegroundColor Cyan; " ^
  "  $dirs = @('promptvault', 'scripts', 'tests'); " ^
  "  foreach ($d in $dirs) { " ^
  "    $s = Join-Path $srcRoot.FullName $d; " ^
  "    if (Test-Path $s) { Copy-Item -Path $s -Destination $PWD.Path -Recurse -Force } " ^
  "  }; " ^
  "  $files = @('pyproject.toml', 'requirements.txt', 'README.md', 'start.bat', 'start_web.bat', 'online.bat', 'guncelle.bat', '.gitignore'); " ^
  "  foreach ($f in $files) { " ^
  "    $sf = Join-Path $srcRoot.FullName $f; " ^
  "    if (Test-Path $sf) { Copy-Item -Path $sf -Destination (Join-Path $PWD.Path $f) -Force } " ^
  "  }; " ^
  "  $verObj = @{ sha = $commit.sha; branch = $branch; message = ($commit.commit.message -split \"`n\")[0]; date = $commit.commit.committer.date }; " ^
  "  $verObj | ConvertTo-Json | Set-Content -Path (Join-Path $PWD.Path '.promptvault_version') -Encoding UTF8; " ^
  "  Write-Host '[BASARILI] Tum kod dosyalari guncellendi!' -ForegroundColor Green; " ^
  "} finally { " ^
  "  if (Test-Path $tmp) { Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue } " ^
  "}"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [HATA] Guncelleme sirasinda bir sorun olustu!
    pause
    exit /b 1
)

if exist ".venv\Scripts\python.exe" (
    echo.
    echo [EK] Python bagimliliklari kontrol ediliyor...
    .\.venv\Scripts\python.exe -m pip install -e ".[web]" --quiet
)

echo.
echo ========================================================
echo   Guncelleme tamamlandi! start_web.bat ile baslatabilirsiniz.
echo ========================================================
pause
