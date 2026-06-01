Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherRoot = Join-Path $repoRoot "tools\launcher"
$sourceDir = Join-Path $launcherRoot "src"
$releaseDir = Join-Path $launcherRoot "release"
$launcherExe = Join-Path $releaseDir "AiGameWorkbenchLauncher.exe"

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

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $launcherExe

$sourceFiles = @(Get-ChildItem -Path $sourceDir -Filter *.cs -File | ForEach-Object { $_.FullName })
if ($sourceFiles.Count -eq 0) {
  throw "No launcher source files found in $sourceDir"
}

& (Resolve-CscExe) /nologo /target:exe /out:$launcherExe /platform:x64 $sourceFiles
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Launcher built: $launcherExe"
