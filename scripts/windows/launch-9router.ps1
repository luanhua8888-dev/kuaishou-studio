$ErrorActionPreference = 'Stop'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$cliPath = Join-Path $env:APPDATA 'npm\node_modules\9router\cli.js'
$dashboardUrl = 'http://127.0.0.1:20128/dashboard'

function Test-RouterReady {
    try {
        $response = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 2 -Proxy $null
        return ($response.StatusCode -eq 200)
    } catch { return $false }
}

try {
    if (-not (Test-RouterReady)) {
        if (-not (Test-Path -LiteralPath $cliPath)) { throw 'Khong tim thay 9router da cai dat.' }
        Start-Process -FilePath $nodePath -ArgumentList @(('"' + $cliPath + '"'), '--skip-update', '--no-browser', '--tray') -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden
        $deadline = (Get-Date).AddSeconds(60)
        while (-not (Test-RouterReady)) {
            if ((Get-Date) -ge $deadline) { throw '9router chua san sang sau 60 giay. Hay thu chay 9router trong terminal de xem loi.' }
            Start-Sleep -Milliseconds 500
        }
    }
    Start-Process $dashboardUrl
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Mo 9router') | Out-Null
}
