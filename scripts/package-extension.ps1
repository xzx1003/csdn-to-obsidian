param(
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$zipName = "csdn-to-obsidian-v$($manifest.version).zip"
$outputPath = Join-Path $root (Join-Path $OutputDir $zipName)
$stagingPath = Join-Path $root (Join-Path $OutputDir ".package")

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null

if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}

if (Test-Path -LiteralPath $stagingPath) {
  Remove-Item -LiteralPath $stagingPath -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stagingPath | Out-Null
Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination $stagingPath
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $stagingPath
Copy-Item -LiteralPath (Join-Path $root "src") -Destination $stagingPath -Recurse

Compress-Archive -Path (Join-Path $stagingPath "*") -DestinationPath $outputPath
Remove-Item -LiteralPath $stagingPath -Recurse -Force

Write-Output $outputPath
