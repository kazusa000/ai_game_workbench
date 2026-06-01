Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$tempDir = Join-Path $env:TEMP "ai-game-workbench-startup-tests"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
  $listener.Start()
  try {
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Start-TestNodeServer([string]$Name, [string]$Script, [int]$Port) {
  $scriptPath = Join-Path $tempDir "$Name.js"
  Set-Content -LiteralPath $scriptPath -Value $Script -Encoding UTF8
  $stdout = Join-Path $tempDir "$Name.out.log"
  $stderr = Join-Path $tempDir "$Name.err.log"
  Remove-Item -Force -ErrorAction SilentlyContinue $stdout, $stderr
  return Start-Process `
    -FilePath "node" `
    -ArgumentList @($scriptPath, "$Port") `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru `
    -WindowStyle Hidden
}

function Wait-Port([int]$Port) {
  for ($i = 0; $i -lt 30; $i += 1) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
      if ($async.AsyncWaitHandle.WaitOne(250)) {
        $client.EndConnect($async)
        return
      }
    } catch {
    } finally {
      $client.Close()
    }
    Start-Sleep -Milliseconds 100
  }
  throw "Port $Port did not open."
}

$apiPort = Get-FreeTcpPort
$webPort = Get-FreeTcpPort
$fakeApi = $null
$fakeWeb = $null

try {
  $fakeApi = Start-TestNodeServer "fake-api" @"
const http = require("http");
const port = Number(process.argv[2]);
http.createServer((request, response) => {
  if (request.url === "/api/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
}).listen(port, "127.0.0.1");
"@ $apiPort
  $fakeWeb = Start-TestNodeServer "fake-web" @"
const http = require("http");
const port = Number(process.argv[2]);
http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("fake web");
}).listen(port, "127.0.0.1");
"@ $webPort
  Wait-Port $apiPort
  Wait-Port $webPort

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\start-workbench.ps1") -NoNgrok -ServerPort $apiPort -WebPort $webPort 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -eq 0) {
    Write-Error "Expected start-workbench.ps1 to reject an incompatible API on port $apiPort, but it exited 0. Output: $output"
  }
  if (-not (($output | Out-String) -match "not the AI Game Workbench API")) {
    Write-Error "Expected incompatible API error message. Output: $output"
  }
  Write-Host "PASS rejects a health-only service on the API port"
} finally {
  foreach ($process in @($fakeApi, $fakeWeb)) {
    if ($process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
    }
  }
}
