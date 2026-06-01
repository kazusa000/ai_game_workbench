Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherRoot = Join-Path $repoRoot "tools\launcher"
$sourceDir = Join-Path $launcherRoot "src"
$testDir = Join-Path $launcherRoot "tests"
$testOutputDir = Join-Path $env:TEMP "ai-game-workbench-launcher-tests"
$testExe = Join-Path $testOutputDir "AiGameWorkbenchLauncher.Tests.exe"

function Resolve-CscExe {
  $candidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  throw "C# compiler not found. Expected csc.exe under $env:WINDIR\Microsoft.NET\Framework64\v4.0.30319."
}

New-Item -ItemType Directory -Force -Path $testOutputDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $testExe

$sourceFiles = @()
if (Test-Path $sourceDir) {
  $sourceFiles += @(Get-ChildItem -Path $sourceDir -Filter *.cs -File | ForEach-Object { $_.FullName })
}
$sourceFiles += @(Get-ChildItem -Path $testDir -Filter *.cs -File | ForEach-Object { $_.FullName })

& (Resolve-CscExe) /nologo /target:exe /main:LauncherCommandTests /out:$testExe $sourceFiles
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& $testExe
exit $LASTEXITCODE
