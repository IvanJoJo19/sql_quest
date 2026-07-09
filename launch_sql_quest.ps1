$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $env:USERPROFILE "scoop\apps\python\current\python.exe"
$stdoutLog = Join-Path $projectDir "backend-launch.out.log"
$stderrLog = Join-Path $projectDir "backend-launch.err.log"
$url = "http://127.0.0.1:8000"

Set-Location $projectDir
$env:PATH = "$env:USERPROFILE\scoop\apps\python\current;$env:USERPROFILE\scoop\apps\postgresql\current\bin;$env:PATH"

if (-not (Test-Path $python)) {
  throw "Python не найден: $python"
}

$healthy = $false

try {
  Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 1 | Out-Null
  $healthy = $true
} catch {
  $healthy = $false
}

if (-not $healthy) {
  "Starting backend at $(Get-Date -Format s)" | Set-Content -LiteralPath $stdoutLog -Encoding UTF8
  "" | Set-Content -LiteralPath $stderrLog -Encoding UTF8
  Start-Process -FilePath $python -ArgumentList "-u backend.py" -WorkingDirectory $projectDir -WindowStyle Minimized -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1

    try {
      Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 1 | Out-Null
      $healthy = $true
      break
    } catch {
      $healthy = $false
    }
  }
}

if (-not $healthy) {
  Start-Process notepad.exe $stderrLog
  throw "Backend не запустился. Открыт лог: $stderrLog"
}

Start-Process $url
