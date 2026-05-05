$ErrorActionPreference = 'Stop'

$port   = 5173
$webDir = Join-Path $PSScriptRoot 'web'

Write-Host ''
Write-Host 'PHD2 Log Viewer - dev server launcher' -ForegroundColor Cyan
Write-Host '====================================='

function Test-DevPort([int]$p) {
    try {
        $null = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

if (Test-DevPort $port) {
    Write-Host ('[OK] Dev server already listening on port {0}' -f $port) -ForegroundColor Green
} else {
    Write-Host ('[..] Port {0} is free - starting `npm run dev` in a new window...' -f $port) -ForegroundColor Yellow

    if (-not (Test-Path $webDir)) {
        Write-Host ('[ERR] web/ directory not found at {0}' -f $webDir) -ForegroundColor Red
        Write-Host ''
        Write-Host 'Press any key to close...'
        [void][System.Console]::ReadKey($true)
        exit 1
    }

    Start-Process -FilePath 'cmd.exe' `
                  -ArgumentList '/k','npm run dev' `
                  -WorkingDirectory $webDir | Out-Null

    Write-Host ('[..] Waiting up to 60s for port {0} to open...' -f $port) -ForegroundColor Yellow
    $deadline = (Get-Date).AddSeconds(60)
    while (-not (Test-DevPort $port)) {
        if ((Get-Date) -gt $deadline) {
            Write-Host ('[ERR] Timed out waiting for port {0}. Check the dev-server window for errors.' -f $port) -ForegroundColor Red
            Write-Host ''
            try { Write-Host 'Press any key to close...'; [void][System.Console]::ReadKey($true) } catch {}
            exit 1
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Host '[OK] Dev server is up.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'URLs' -ForegroundColor Cyan
Write-Host '----'
Write-Host ('  Local:     http://localhost:{0}/' -f $port)

# LAN IPv4 addresses (skip loopback and APIPA)
$lanIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress    -notlike '127.*' -and
        $_.IPAddress    -notlike '169.254.*' -and
        $_.PrefixOrigin -ne     'WellKnown'
    } |
    Sort-Object IPAddress

foreach ($ip in $lanIps) {
    Write-Host ('  Network:   http://{0}:{1}/' -f $ip.IPAddress, $port)
}

# Public (WAN) IP
try {
    $publicIp = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5).ToString().Trim()
    Write-Host ('  Public IP: {0}   (would need router port-forward of {1} to reach from outside your LAN)' -f $publicIp, $port)
} catch {
    Write-Host '  Public IP: <unable to fetch - no internet?>'
}

Write-Host ''
Write-Host ('Port: {0}' -f $port) -ForegroundColor Cyan
Write-Host ''
Write-Host 'Note: first LAN access may trigger a Windows Firewall prompt for node.exe - allow it on Private networks.'
Write-Host ''
try {
    Write-Host 'Press any key to close this window...'
    [void][System.Console]::ReadKey($true)
} catch {
    # No interactive console (e.g. piped/redirected) - just exit.
}
