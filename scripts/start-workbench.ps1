param(
  [string]$CloudflaredPath = $(if ($env:CLOUDFLARED_PATH) { $env:CLOUDFLARED_PATH } else { "" }),
  [int]$ServerPort = $(if ($env:PORT) { [int]$env:PORT } else { 8787 }),
  [int]$WebPort = 5173,
  [switch]$NoTunnel,
  [switch]$NoNgrok,
  [switch]$OpenBrowser,
  [switch]$Check
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverStorageDir = Join-Path $repoRoot "apps\server\storage"
$logDir = Join-Path $serverStorageDir "logs\workbench"
$publicTunnelConfigPath = Join-Path $serverStorageDir "config\public-tunnel.json"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Resolve-CloudflaredExe([string]$RequestedPath) {
  if ($RequestedPath.Trim()) {
    if (Test-Path $RequestedPath) {
      return (Resolve-Path $RequestedPath).Path
    }
    throw "cloudflared.exe was not found at $RequestedPath"
  }
  $command = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $repoToolExe = Join-Path $repoRoot "tools\cloudflared\cloudflared.exe"
  if (Test-Path $repoToolExe) {
    return $repoToolExe
  }
  $repoFlatExe = Join-Path $repoRoot "tools\cloudflared.exe"
  if (Test-Path $repoFlatExe) {
    return $repoFlatExe
  }
  $runtimeExe = Join-Path $serverStorageDir "runtime\cloudflared\cloudflared.exe"
  if (Test-Path $runtimeExe) {
    return $runtimeExe
  }
  $runtimeDir = Split-Path -Parent $runtimeExe
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Write-Host "cloudflared.exe was not found. Downloading Cloudflare Quick Tunnel runtime..."
  try {
    Invoke-WebRequest `
      -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
      -OutFile $runtimeExe `
      -UseBasicParsing
    return $runtimeExe
  } catch {
    Remove-Item -Force -ErrorAction SilentlyContinue $runtimeExe
    throw "cloudflared.exe download failed. Install cloudflared, set CLOUDFLARED_PATH, or put cloudflared.exe at $repoToolExe. $($_.Exception.Message)"
  }
}

function Test-WorkbenchApi([int]$Port, [string]$ExpectedStorageDir) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/api/health" -Method Get -TimeoutSec 3
    if (-not $health.ok) {
      return $false
    }
    if (-not $health.PSObject.Properties["storageDir"]) {
      return $false
    }
    if ([string]$health.storageDir -ne $ExpectedStorageDir) {
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

function Get-CloudflaredTunnelUrl {
  foreach ($name in @("cloudflared.err.log", "cloudflared.out.log")) {
    $path = Join-Path $logDir $name
    if (-not (Test-Path $path)) {
      continue
    }
    $content = Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue
    if ($content -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
      return $Matches[0]
    }
  }
  return $null
}

function Wait-CloudflaredTunnelUrl([int]$TimeoutSeconds = 60) {
  for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
    $url = Get-CloudflaredTunnelUrl
    if ($url) {
      return $url
    }
    Start-Sleep -Seconds 1
  }
  throw "cloudflared startup timed out before it printed a trycloudflare.com URL. Check logs at $logDir"
}

function Clear-PublicTunnelConfig {
  Remove-Item -Force -ErrorAction SilentlyContinue $publicTunnelConfigPath
}

function Write-PublicTunnelConfig([string]$TunnelUrl) {
  $configDir = Split-Path -Parent $publicTunnelConfigPath
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  $publicAssetBaseUrl = "$($TunnelUrl.TrimEnd("/"))/assets"
  [pscustomobject]@{
    provider = "cloudflare-quick-tunnel"
    url = $TunnelUrl.TrimEnd("/")
    publicAssetBaseUrl = $publicAssetBaseUrl
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath $publicTunnelConfigPath -Encoding UTF8
  return $publicAssetBaseUrl
}

$disableTunnel = $NoTunnel -or $NoNgrok
$cloudflaredExe = if ($disableTunnel) { $null } else { Resolve-CloudflaredExe $CloudflaredPath }
$npmCmd = "npm.cmd"
$env:STORAGE_DIR = $serverStorageDir

if ($Check) {
  [pscustomobject]@{
    repoRoot = $repoRoot
    storage = $serverStorageDir
    server = "http://127.0.0.1:$ServerPort"
    web = "http://127.0.0.1:$WebPort"
    tunnelProvider = if ($disableTunnel) { $null } else { "cloudflare-quick-tunnel" }
    cloudflaredExe = $cloudflaredExe
    publicTunnelConfig = $publicTunnelConfigPath
    logs = $logDir
  } | ConvertTo-Json -Compress
  exit 0
}

Clear-PublicTunnelConfig

if (-not (Test-WorkbenchApi $ServerPort $serverStorageDir)) {
  if (Test-TcpPort $ServerPort) {
    throw "Port $ServerPort is already in use, but it is not the AI Game Workbench API with storage $serverStorageDir. Stop the process using that port or start the workbench with a different -ServerPort."
  }
  Remove-Item Env:\PUBLIC_ASSET_BASE_URL -ErrorAction SilentlyContinue
  Start-WorkbenchProcess "server" $npmCmd @("run", "dev:server") | Out-Null
  Wait-Until { Test-WorkbenchApi $ServerPort $serverStorageDir } "server"
} else {
  Write-Host "Server is already running: http://127.0.0.1:$ServerPort"
}

if (-not $disableTunnel) {
  Start-WorkbenchProcess "cloudflared" $cloudflaredExe @("tunnel", "--url", "http://127.0.0.1:$ServerPort") | Out-Null
  $tunnelUrl = Wait-CloudflaredTunnelUrl
  $publicAssetBaseUrl = Write-PublicTunnelConfig $tunnelUrl
  Write-Host "cloudflared tunnel is ready: $tunnelUrl"
}

if (-not (Test-TcpPort $WebPort)) {
  Start-WorkbenchProcess "web" $npmCmd @("run", "dev:web") | Out-Null
  Wait-Until { Test-TcpPort $WebPort } "web"
} else {
  Write-Host "Web is already running: http://127.0.0.1:$WebPort"
}

Write-Host ""
Write-Host "Workbench: http://127.0.0.1:$WebPort"
if (-not $disableTunnel) {
  Write-Host "Public tunnel: $tunnelUrl"
  Write-Host "Uploaded asset prefix: $publicAssetBaseUrl"
}
Write-Host "Logs: $logDir"

if ($OpenBrowser) {
  Start-Process "http://127.0.0.1:$WebPort"
}
