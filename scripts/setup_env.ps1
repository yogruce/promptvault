# PromptVault - Otomatik Python & Sanal Ortam (.venv) Kurulum Betigi
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

$VenvDir = Join-Path $ProjectRoot ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

function Invoke-PythonCheck {
    param(
        [string]$Exe,
        [string[]]$Arguments
    )
    if (-not (Test-Path -LiteralPath $Exe) -and -not (Get-Command $Exe -ErrorAction SilentlyContinue)) {
        return @{ ExitCode = 1; Output = "" }
    }
    try {
        $pinfo = New-Object System.Diagnostics.ProcessStartInfo
        $pinfo.FileName = $Exe
        $escapedArgs = $Arguments | ForEach-Object {
            if ($_ -match '[\s"]') {
                '"' + ($_ -replace '"', '\"') + '"'
            } else {
                $_
            }
        }
        $pinfo.Arguments = ($escapedArgs -join " ")
        $pinfo.RedirectStandardOutput = $true
        $pinfo.RedirectStandardError = $true
        $pinfo.UseShellExecute = $false
        $pinfo.CreateNoWindow = $true
        $proc = [System.Diagnostics.Process]::Start($pinfo)
        $stdout = $proc.StandardOutput.ReadToEnd()
        $stderr = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()
        return @{
            ExitCode = $proc.ExitCode
            Output   = $stdout.Trim()
            Error    = $stderr.Trim()
        }
    } catch {
        return @{ ExitCode = 1; Output = ""; Error = $_.Exception.Message }
    }
}

function Test-VenvReady {
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        return $false
    }
    $res = Invoke-PythonCheck -Exe $VenvPython -Arguments @("-c", "import sys; assert sys.version_info >= (3, 10); import promptvault, fastapi, uvicorn, PIL, multipart; print('OK')")
    return ($res.ExitCode -eq 0 -and $res.Output -match "OK")
}

function Test-VenvPythonValid {
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        return $false
    }
    $res = Invoke-PythonCheck -Exe $VenvPython -Arguments @("-c", "import sys; assert sys.version_info >= (3, 10); print('VALID')")
    return ($res.ExitCode -eq 0 -and $res.Output -match "VALID")
}

# 1. Mevcut .venv saglikli ve tum paketler kurulu mu kontrol et
if (Test-VenvReady) {
    exit 0
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  PromptVault Ilk Kurulum ve Ortam Hazirlama Sihirbazi" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Eger .venv baska bilgisayardan kopyalandiysa veya Python surumu uyumsuzsa sil
if ((Test-Path -LiteralPath $VenvDir) -and (-not (Test-VenvPythonValid))) {
    Write-Host "[BILGI] Mevcut .venv klasoru bu bilgisayarla uyumsuz (farkli PC veya eski Python surumu)." -ForegroundColor Yellow
    Write-Host "[BILGI] Eski .venv temizleniyor ve bu bilgisayar icin sifirdan kuruluyor..." -ForegroundColor Yellow
    Remove-Item -LiteralPath $VenvDir -Recurse -Force -ErrorAction SilentlyContinue
}

function Test-PythonCandidate {
    param(
        [string]$Exe,
        [string[]]$PrefixArgs = @()
    )
    $allArgs = @()
    if ($PrefixArgs) { $allArgs += $PrefixArgs }
    $allArgs += @("-c", "import sys, venv; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor) + '|' + sys.executable)")
    $res = Invoke-PythonCheck -Exe $Exe -Arguments $allArgs
    if ($res.ExitCode -ne 0 -or -not $res.Output) {
        return $null
    }
    $line = ($res.Output -split "`r?`n" | Select-Object -Last 1).Trim()
    $parts = $line -split '\|', 2
    if ($parts.Count -ne 2) { return $null }
    $verParts = $parts[0] -split '\.'
    if ($verParts.Count -lt 2) { return $null }
    $major = [int]$verParts[0]
    $minor = [int]$verParts[1]
    $exePath = $parts[1].Trim()
    if ($exePath -match "WindowsApps") { return $null }
    if (-not (Test-Path -LiteralPath $exePath)) { return $null }
    return @{
        Major      = $major
        Minor      = $minor
        Exe        = $exePath
        Compatible = ($major -eq 3 -and $minor -ge 10)
    }
}

function Find-CompatiblePython {
    $foundOld = @()

    # A) py.exe Launcher ile kontrol (en stabil surumlerden baslayarak)
    $pyCmd = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($pyCmd -and $pyCmd.Source) {
        foreach ($tag in @("-3.12", "-3.11", "-3.10", "-3.13", "-3.14", "-3")) {
            $info = Test-PythonCandidate -Exe $pyCmd.Source -PrefixArgs @($tag)
            if ($info) {
                if ($info.Compatible) { return $info }
                $foundOld += "$($info.Major).$($info.Minor) ($($info.Exe))"
            }
        }
    }

    # B) Bilinen kurulum klasorlerini tara (PATH'e eklenmemis olsa bile bulur)
    $searchRoots = @(
        "$env:LOCALAPPDATA\Programs\Python",
        "$env:ProgramFiles",
        "${env:ProgramFiles(x86)}",
        "C:\"
    )
    $candidatePaths = @()
    foreach ($root in $searchRoots) {
        if ($root -and (Test-Path -LiteralPath $root)) {
            $dirs = Get-ChildItem -LiteralPath $root -Directory -Filter "Python3*" -ErrorAction SilentlyContinue |
                    Sort-Object Name -Descending
            foreach ($d in $dirs) {
                $p = Join-Path $d.FullName "python.exe"
                if (Test-Path -LiteralPath $p) {
                    $candidatePaths += $p
                }
            }
        }
    }

    # C) PATH uzerindeki python komutlari (WindowsApps sahte kisayolu haric)
    $pathPythons = Get-Command "python.exe", "python3.exe" -All -ErrorAction SilentlyContinue
    foreach ($cmd in $pathPythons) {
        if ($cmd.Source -and ($cmd.Source -notmatch "WindowsApps")) {
            $candidatePaths += $cmd.Source
        }
    }

    foreach ($path in ($candidatePaths | Select-Object -Unique)) {
        $info = Test-PythonCandidate -Exe $path
        if ($info) {
            if ($info.Compatible) { return $info }
            $foundOld += "$($info.Major).$($info.Minor) ($($info.Exe))"
        }
    }

    if ($foundOld.Count -gt 0) {
        $uniqueOld = ($foundOld | Select-Object -Unique) -join ", "
        Write-Host "[UYARI] Bilgisayarda eski Python surumu bulundu: $uniqueOld" -ForegroundColor Yellow
        Write-Host "[UYARI] PromptVault icin Python 3.10 veya uzeri gereklidir." -ForegroundColor Yellow
    }
    return $null
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$userPath;$machinePath"
}

function Install-Python312 {
    Write-Host ""
    Write-Host "[BILGI] Uygun Python surumu (3.10+) bulunamadi." -ForegroundColor Yellow
    Write-Host "[BILGI] Python 3.12 otomatik olarak indiriliyor ve kuruluyor..." -ForegroundColor Cyan
    Write-Host "Lutfen bekleyin, bu islem internet hiziniza gore 1-2 dakika surebilir." -ForegroundColor Gray
    Write-Host ""

    # 1. Yontem: winget varsa dene
    $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
    if ($winget -and $winget.Source) {
        try {
            Write-Host "[1/2] Windows Paket Yoneticisi (winget) ile Python 3.12 kuruluyor..." -ForegroundColor Cyan
            & $winget.Source install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements --silent
            Refresh-ProcessPath
            $check = Find-CompatiblePython
            if ($check) { return $check }
        } catch {
            Write-Host "[BILGI] winget ile kurulum atlandi, dogrudan resmi kurucu indiriliyor..." -ForegroundColor Yellow
        }
    }

    # 2. Yontem: Resmi python.org kurucusunu indir ve kur (Admin yetkisi gerektirmez)
    $is64 = [Environment]::Is64BitOperatingSystem
    $url = if ($is64) {
        "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
    } else {
        "https://www.python.org/ftp/python/3.12.8/python-3.12.8.exe"
    }
    $installer = Join-Path $env:TEMP "python-3.12.8-installer.exe"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Host "[INDIRILIYOR] $url ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
        Write-Host "[KURULUYOR] Python 3.12.8 kuruluyor (Lutfen acilan kurulum penceresinin tamamlanmasini bekleyin)..." -ForegroundColor Cyan
        $proc = Start-Process -FilePath $installer -ArgumentList "/passive InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_venv=1 Include_test=0 SimpleInstall=1" -Wait -PassThru
        Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
        Refresh-ProcessPath
        $check = Find-CompatiblePython
        if ($check) { return $check }
    } catch {
        Write-Host "[HATA] Otomatik Python indirme/kurulum sirasinda hata olustu: $_" -ForegroundColor Red
    }
    return $null
}

# 2. Eger .venv henuz yoksa uyumlu Python bul veya otomatik kur
if (-not (Test-VenvPythonValid)) {
    $pyInfo = Find-CompatiblePython
    if (-not $pyInfo) {
        $pyInfo = Install-Python312
    }

    if (-not $pyInfo) {
        Write-Host ""
        Write-Host "[HATA] Uygun bir Python (3.10 veya uzeri) bulunamadi ve otomatik kurulamadi!" -ForegroundColor Red
        Write-Host "Lutfen https://www.python.org/downloads/ adresinden Python 3.12 surumunu indirin" -ForegroundColor Yellow
        Write-Host "ve kurulum ekraninin en altindaki 'Add Python to PATH' kutucugunu isaretleyin." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "[BILGI] Kullanilan Python: $($pyInfo.Major).$($pyInfo.Minor) ($($pyInfo.Exe))" -ForegroundColor Green
    Write-Host "[BILGI] Sanal ortam (.venv) olusturuluyor..." -ForegroundColor Cyan
    & $pyInfo.Exe -m venv $VenvDir
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        Write-Host "[HATA] .venv sanal ortami olusturulamadi!" -ForegroundColor Red
        exit 1
    }
}

# 3. Pip, Setuptools, Wheel ve PromptVault paketlerini eksiksiz yukle
Write-Host "[BILGI] Pip ve temel kurulum araclari guncelleniyor..." -ForegroundColor Cyan
& $VenvPython -m ensurepip --upgrade | Out-Null
& $VenvPython -m pip install --upgrade pip setuptools wheel

Write-Host "[BILGI] PromptVault ve gerekli tum kutuphaneler yukleniyor..." -ForegroundColor Cyan
& $VenvPython -m pip install -e ".[web]"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[UYARI] Editable kurulumda sorun olustu, requirements.txt ile yeniden deneniyor..." -ForegroundColor Yellow
    & $VenvPython -m pip install -r requirements.txt
}

# 4. Son dogrulama
if (-not (Test-VenvReady)) {
    Write-Host "[HATA] Paket kurulumu tamamlanamadi! Lutfen internet baglantinizi kontrol edin." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[BASARILI] PromptVault ilk kurulumu eksiksiz tamamlandi!" -ForegroundColor Green
Write-Host ""
exit 0
