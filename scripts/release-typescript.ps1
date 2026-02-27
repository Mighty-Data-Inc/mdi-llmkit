<#
.SYNOPSIS
Builds, tests, and publishes the TypeScript package to npm.

.DESCRIPTION
Runs release preflight checks, installs dependencies, runs tests/build,
and publishes `packages/typescript-mdi-llmkit` with npm provenance.

.EXAMPLE
.\scripts\release-typescript.ps1

.EXAMPLE
powershell -File .\scripts\release-typescript.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$preflightScript = Join-Path $repoRoot "scripts/release-preflight.ps1"
$packageDir = Join-Path $repoRoot "packages/typescript-mdi-llmkit"

Write-Host "Running release preflight checks..."
& $preflightScript

Push-Location $packageDir
try {
    Write-Host "Publishing TypeScript package from $packageDir"
    npm ci
    npm test
    npm run build
    npm publish --access public --provenance
}
finally {
    Pop-Location
}
