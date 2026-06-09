param(
  [string]$CloudflaredPath = $(if ($env:CLOUDFLARED_PATH) { $env:CLOUDFLARED_PATH } else { "" }),
  [int]$ServerPort = $(if ($env:PORT) { [int]$env:PORT } else { 8787 }),
  [int]$WebPort = 5173,
  [switch]$NoTunnel,
  [switch]$NoNgrok,
  [switch]$OpenBrowser,
  [switch]$Check,
  [switch]$ExitAfterStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverStorageDir = Join-Path $repoRoot "apps\server\storage"
$logDir = Join-Path $serverStorageDir "logs\workbench"
$publicTunnelConfigPath = Join-Path $serverStorageDir "config\public-tunnel.json"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-StartupProgress([int]$Percent, [string]$Message) {
  if ($Check) {
    return
  }
  $boundedPercent = [Math]::Max(0, [Math]::Min(100, $Percent))
  Write-Progress -Activity "AI Game Workbench startup" -Status $Message -PercentComplete $boundedPercent
  Write-Host ("[{0,3}%] {1}" -f $boundedPercent, $Message)
}

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
  Write-StartupProgress 8 "cloudflared.exe not found; downloading Cloudflare Quick Tunnel runtime..."
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

function Resolve-NpmCmd {
  $candidatePaths = @(
    (Join-Path $repoRoot "tools\node\npm.cmd"),
    (Join-Path $repoRoot "tools\nodejs\npm.cmd")
  )
  foreach ($candidatePath in $candidatePaths) {
    if (Test-Path $candidatePath) {
      $nodeDir = Split-Path -Parent $candidatePath
      $env:Path = "$nodeDir;$env:Path"
      return (Resolve-Path $candidatePath).Path
    }
  }

  $nestedToolNpm = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot "tools") -Recurse -Filter "npm.cmd" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\node[^\\]*\\npm\.cmd$" } |
    Sort-Object FullName |
    Select-Object -First 1)
  if ($nestedToolNpm.Count -gt 0) {
    $nodeDir = Split-Path -Parent $nestedToolNpm[0].FullName
    $env:Path = "$nodeDir;$env:Path"
    return $nestedToolNpm[0].FullName
  }

  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command npm -ErrorAction SilentlyContinue
  }
  if ($command) {
    return $command.Source
  }

  throw "Node.js/npm was not found. Install Node.js 20+, or use the full portable package containing tools\node\npm.cmd."
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
  if (-not (Test-Path $FilePath)) {
    $command = Get-Command $FilePath -ErrorAction SilentlyContinue
    if (-not $command) {
      throw "Failed to start $($Name): executable was not found: $FilePath."
    }
    $FilePath = $command.Source
  }
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

function Stop-ExistingWorkbenchTunnelProcesses([int]$Port) {
  $pattern = "http://127.0.0.1:$Port"
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -ieq "cloudflared.exe" -and $_.CommandLine -like "*tunnel*" -and $_.CommandLine -like "*$pattern*"
  })
  foreach ($process in $processes) {
    Write-StartupProgress 34 "Stopping previous cloudflared tunnel process $($process.ProcessId)..."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Get-WorkbenchServiceProcesses([int]$ServerPort, [int]$WebPort) {
  $escapedRepoRoot = [Regex]::Escape($repoRoot)
  $serverPortPattern = "http://127.0.0.1:$ServerPort"
  $candidates = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $commandLine = [string]$_.CommandLine
    if (-not $commandLine) {
      return $false
    }
    if ($_.Name -ieq "cloudflared.exe") {
      return $commandLine -like "*tunnel*" -and $commandLine -like "*$serverPortPattern*"
    }
    if ($commandLine -notmatch $escapedRepoRoot) {
      return $false
    }
    return (
      ($_.Name -in @("node.exe", "cmd.exe")) -and (
        $commandLine -like "*run dev:server*" -or
        $commandLine -like "*run dev:web*" -or
        $commandLine -like "*run dev -w apps/server*" -or
        $commandLine -like "*run dev -w apps/web*" -or
        $commandLine -like "*tsx*watch src/index.ts*" -or
        $commandLine -like "*src/index.ts*" -or
        $commandLine -like "*vite.js*--host 127.0.0.1*"
      )
    )
  })
  return $candidates | Sort-Object ProcessId -Descending
}

function Stop-WorkbenchServiceProcesses([int]$ServerPort, [int]$WebPort) {
  Write-Host ""
  Write-Host "Stopping AI Game Workbench services..."
  foreach ($process in @(Get-WorkbenchServiceProcesses $ServerPort $WebPort)) {
    Write-Host "Stopping $($process.Name) PID $($process.ProcessId)"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Clear-PublicTunnelConfig
}

function Wait-WorkbenchUntilStopped([int]$ServerPort, [int]$WebPort) {
  Write-Host ""
  Write-Host "AI Game Workbench is running."
  Write-Host "Keep this terminal open while working."
  Write-Host "Press Ctrl+C or close this terminal to stop backend, frontend, and Cloudflare tunnel."
  try {
    while ($true) {
      Start-Sleep -Seconds 2
      $serviceCount = @(Get-WorkbenchServiceProcesses $ServerPort $WebPort).Count
      if ($serviceCount -eq 0) {
        Write-Host "Workbench services are no longer running."
        return
      }
    }
  } finally {
    Stop-WorkbenchServiceProcesses $ServerPort $WebPort
  }
}

function Wait-CloudflaredTunnelUrl([int]$TimeoutSeconds = 60, [int]$StartPercent = 36, [int]$EndPercent = 72) {
  for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
    $url = Get-CloudflaredTunnelUrl
    if ($url) {
      Write-StartupProgress $EndPercent "Cloudflare tunnel URL received."
      return $url
    }
    $percent = $StartPercent + [Math]::Floor((($EndPercent - $StartPercent) * $i) / [Math]::Max(1, $TimeoutSeconds))
    Write-StartupProgress $percent "Waiting for Cloudflare tunnel URL..."
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
$npmCmd = Resolve-NpmCmd
$env:STORAGE_DIR = $serverStorageDir
$env:PORT = "$ServerPort"

if ($Check) {
  [pscustomobject]@{
    repoRoot = $repoRoot
    storage = $serverStorageDir
    server = "http://127.0.0.1:$ServerPort"
    web = "http://127.0.0.1:$WebPort"
    tunnelProvider = if ($disableTunnel) { $null } else { "cloudflare-quick-tunnel" }
    cloudflaredExe = $cloudflaredExe
    npmCmd = $npmCmd
    publicTunnelConfig = $publicTunnelConfigPath
    logs = $logDir
  } | ConvertTo-Json -Compress
  exit 0
}

Clear-PublicTunnelConfig
Write-StartupProgress 5 "Preparing local storage and startup logs..."

if (-not (Test-WorkbenchApi $ServerPort $serverStorageDir)) {
  if (Test-TcpPort $ServerPort) {
    throw "Port $ServerPort is already in use, but it is not the AI Game Workbench API with storage $serverStorageDir. Stop the process using that port or start the workbench with a different -ServerPort."
  }
  Remove-Item Env:\PUBLIC_ASSET_BASE_URL -ErrorAction SilentlyContinue
  Write-StartupProgress 15 "Starting API server..."
  Start-WorkbenchProcess "server" $npmCmd @("run", "dev:server") | Out-Null
  Wait-Until { Test-WorkbenchApi $ServerPort $serverStorageDir } "server"
  Write-StartupProgress 28 "API server is ready."
} else {
  Write-StartupProgress 28 "API server is already ready."
  Write-Host "Server is already running: http://127.0.0.1:$ServerPort"
}

if (-not $disableTunnel) {
  Stop-ExistingWorkbenchTunnelProcesses $ServerPort
  Write-StartupProgress 35 "Starting Cloudflare tunnel before web startup..."
  Start-WorkbenchProcess "cloudflared" $cloudflaredExe @("tunnel", "--url", "http://127.0.0.1:$ServerPort") | Out-Null
  $tunnelUrl = Wait-CloudflaredTunnelUrl
  $publicAssetBaseUrl = Write-PublicTunnelConfig $tunnelUrl
  Write-StartupProgress 75 "Cloudflare tunnel is ready; web startup can continue."
  Write-Host "cloudflared tunnel is ready: $tunnelUrl"
} else {
  Write-StartupProgress 75 "Tunnel disabled; web startup can continue."
}

if (-not (Test-TcpPort $WebPort)) {
  Write-StartupProgress 82 "Starting web server..."
  Start-WorkbenchProcess "web" $npmCmd @("run", "dev", "-w", "apps/web", "--", "--port", "$WebPort") | Out-Null
  Wait-Until { Test-TcpPort $WebPort } "web"
  Write-StartupProgress 94 "Web server is ready."
} else {
  Write-StartupProgress 94 "Web server is already ready."
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
  Write-StartupProgress 98 "Opening browser..."
  Start-Process "http://127.0.0.1:$WebPort"
}
Write-StartupProgress 100 "Startup complete."
Write-Progress -Activity "AI Game Workbench startup" -Completed

if (-not $ExitAfterStart) {
  Wait-WorkbenchUntilStopped $ServerPort $WebPort
}
