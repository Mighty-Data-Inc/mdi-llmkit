<#
.SYNOPSIS
Publishes both TypeScript and Python packages.

.DESCRIPTION
Runs release preflight checks, then publishes TypeScript first and Python second.

.EXAMPLE
.\scripts\release-all.ps1

.EXAMPLE
powershell -File .\scripts\release-all.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$preflightScript = Join-Path $repoRoot "scripts/release-preflight.ps1"

Write-Host "Running release preflight checks..."
& $preflightScript

Write-Host "Starting TypeScript release..."
& (Join-Path $repoRoot "scripts/release-typescript.ps1")
Write-Host "Starting Python release..."
& (Join-Path $repoRoot "scripts/release-python.ps1")
