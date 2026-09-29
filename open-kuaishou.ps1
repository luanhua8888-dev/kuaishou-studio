$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = 'http://localhost:3000'

try {
    $status = Invoke-RestMethod -Uri "$appUrl/api/sheet-queue" -TimeoutSec 2
    if ($status.sheetUrl) {
        Start-Process $appUrl
        exit 0
    }
} catch {
    # The app is not running yet.
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
Start-Process -FilePath $nodePath -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden
