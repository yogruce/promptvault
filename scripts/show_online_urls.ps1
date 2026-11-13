param([int]$Port = 7860)

$tsExe = if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    'tailscale'
} elseif (Test-Path "$env:ProgramFiles\Tailscale\tailscale.exe") {
    "$env:ProgramFiles\Tailscale\tailscale.exe"
} else {
    $null
}

Write-Host '--------------------------------------------------------' -ForegroundColor DarkGray
Write-Host '  ERISIM ADRESLERI:' -ForegroundColor Cyan
Write-Host "  * PC (Yerel)        : http://127.0.0.1:$Port"

$lanIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.IPAddress -notlike '100.*'
    } |
    Select-Object -ExpandProperty IPAddress -Unique

foreach ($ip in $lanIps) {
    Write-Host "  * Ayni Wi-Fi (LAN)  : http://$ip`:$Port"
}

if ($tsExe) {
    $tsIp = (& $tsExe ip -4 2>$null | Select-Object -First 1)
    if ($tsIp -and $tsIp.Trim() -match '^\d+\.\d+\.\d+\.\d+$') {
        $tsIpClean = $tsIp.Trim()
        Write-Host "  * iPhone (Tailscale): http://$tsIpClean`:$Port" -ForegroundColor Green
        try {
            $st = (& $tsExe status --json 2>$null | ConvertFrom-Json)
            $dnsName = $st.Self.DNSName
            if ($dnsName) {
                $dnsClean = $dnsName.TrimEnd('.')
                Write-Host "  * iPhone (MagicDNS) : http://$dnsClean`:$Port" -ForegroundColor Green
            }
        } catch {}
    } else {
        Write-Host '  * Tailscale kurulu ama henuz oturum acilmamis!' -ForegroundColor Yellow
        Write-Host '    Sag alttaki Tailscale simgesinden giris yapip VPN''i acin.' -ForegroundColor Yellow
    }
} else {
    Write-Host '  * Tailscale kurulu degil (farkli aglardan iPhone erisimi icin Tailscale kurun).' -ForegroundColor Yellow
}
Write-Host '--------------------------------------------------------' -ForegroundColor DarkGray
