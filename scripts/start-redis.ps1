# Start portable Redis for local ranking response cache.
# Downloads microsoftarchive Redis 3.0.504 once into tools/redis if missing.

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$tools = Join-Path $repo "tools\redis"
$server = Join-Path $tools "redis-server.exe"
$cli = Join-Path $tools "redis-cli.exe"
$zip = Join-Path $tools "Redis-x64-3.0.504.zip"
$url = "https://github.com/microsoftarchive/redis/releases/download/win-3.0.504/Redis-x64-3.0.504.zip"

New-Item -ItemType Directory -Force -Path $tools | Out-Null

if (-not (Test-Path $server)) {
  Write-Host "Downloading portable Redis..."
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $tools -Force
}

try {
  $pong = & $cli ping 2>$null
  if ($pong -eq "PONG") {
    Write-Host "Redis already running on 6379"
    exit 0
  }
} catch { }

Write-Host "Starting Redis on 6379..."
Start-Process -FilePath $server -ArgumentList "--port", "6379" -WorkingDirectory $tools -WindowStyle Hidden
Start-Sleep -Seconds 2
& $cli ping
