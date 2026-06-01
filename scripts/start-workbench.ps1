param(
  [string]$NgrokUrl = $(if ($env:AI_GAME_WORKBENCH_PUBLIC_URL) { $env:AI_GAME_WORKBENCH_PUBLIC_URL } else { "https://darn-skittle-unwoven.ngrok-free.dev" }),
  [int]$ServerPort = $(if ($env:PORT) { [int]$env:PORT } else { 8787 }),
  [int]$WebPort = 5173,
  [switch]$NoNgrok,
  [switch]$OpenBrowser,
  [switch]$Check
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot "storage\logs\workbench"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Resolve-NgrokExe {
  $command = Get-Command ngrok -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $localExe = Join-Path $env:LOCALAPPDATA "Programs\ngrok\ngrok.exe"
  if (Test-Path $localExe) {
    return $localExe
  }
  throw "ngrok.exe was not found. Install ngrok or put ngrok.exe at $localExe"
}

function Test-WorkbenchApi([int]$Port) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/api/health" -Method Get -TimeoutSec 3
    if (-not $health.ok) {
      return $false
    }
    $characters = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/api/characters" -Method Get -TimeoutSec 3
    return $null -ne $characters.PSObject.Properties["characters"]
  } catch {
    return $false
  }
}

function Test-TcpPort([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Start-WorkbenchProcess([string]$Name, [string]$FilePath, [string[]]$Arguments) {
  $stdout = Join-Path $logDir "$Name.out.log"
  $stderr = Join-Path $logDir "$Name.err.log"
  Remove-Item -Force -ErrorAction SilentlyContinue $stdout, $stderr
  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru `
    -WindowStyle Hidden
  Write-Host "Started $Name, PID $($process.Id), log: $stdout"
  return $process
}

function Wait-Until([scriptblock]$Probe, [string]$Label, [int]$TimeoutSeconds = 45) {
  for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
    if (& $Probe) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "$Label startup timed out. Check logs at $logDir"
}

function Get-NgrokTunnelUrl {
  try {
    $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -Method Get -TimeoutSec 2
    $httpsTunnel = @($tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1)
    if ($httpsTunnel) {
      return [string]$httpsTunnel.public_url
    }
  } catch {
    return $null
  }
  return $null
}

$ngrokExe = if ($NoNgrok) { $null } else { Resolve-NgrokExe }
$npmCmd = "npm.cmd"
$normalizedNgrokUrl = $NgrokUrl.TrimEnd("/")
$publicAssetBaseUrl = "$normalizedNgrokUrl/assets"

if ($Check) {
  [pscustomobject]@{
    repoRoot = $repoRoot
    server = "http://127.0.0.1:$ServerPort"
    web = "http://127.0.0.1:$WebPort"
    ngrok = if ($NoNgrok) { $null } else { $normalizedNgrokUrl }
    ngrokExe = $ngrokExe
    publicAssetBaseUrl = if ($NoNgrok) { $null } else { $publicAssetBaseUrl }
    logs = $logDir
  } | ConvertTo-Json -Compress
  exit 0
}

if (-not (Test-WorkbenchApi $ServerPort)) {
  if (Test-TcpPort $ServerPort) {
    throw "Port $ServerPort is already in use, but it is not the AI Game Workbench API. Stop the process using that port or start the workbench with a different -ServerPort."
  }
  $env:PUBLIC_ASSET_BASE_URL = $publicAssetBaseUrl
  Start-WorkbenchProcess "server" $npmCmd @("run", "dev:server") | Out-Null
  Wait-Until { Test-WorkbenchApi $ServerPort } "server"
} else {
  Write-Host "Server is already running: http://127.0.0.1:$ServerPort"
}

if (-not $NoNgrok) {
  $currentTunnelUrl = Get-NgrokTunnelUrl
  if ($currentTunnelUrl -eq $normalizedNgrokUrl) {
    Write-Host "ngrok is already running: $currentTunnelUrl"
  } else {
    if ($currentTunnelUrl) {
      Write-Host "Detected another ngrok tunnel: $currentTunnelUrl. Starting the configured tunnel."
    }
    Start-WorkbenchProcess "ngrok" $ngrokExe @("http", "--url", $normalizedNgrokUrl, "http://127.0.0.1:$ServerPort", "--log", "stdout") | Out-Null
    Wait-Until { (Get-NgrokTunnelUrl) -eq $normalizedNgrokUrl } "ngrok"
  }
}

if (-not (Test-TcpPort $WebPort)) {
  Start-WorkbenchProcess "web" $npmCmd @("run", "dev:web") | Out-Null
  Wait-Until { Test-TcpPort $WebPort } "web"
} else {
  Write-Host "Web is already running: http://127.0.0.1:$WebPort"
}

Write-Host ""
Write-Host "Workbench: http://127.0.0.1:$WebPort"
if (-not $NoNgrok) {
  Write-Host "Public asset base: $normalizedNgrokUrl"
  Write-Host "Uploaded asset prefix: $publicAssetBaseUrl"
}
Write-Host "Logs: $logDir"

if ($OpenBrowser) {
  Start-Process "http://127.0.0.1:$WebPort"
}
