<#
.SYNOPSIS
Builds, validates, and publishes the Python package to PyPI.

.DESCRIPTION
Runs release preflight checks, builds with Hatch, validates artifacts with Twine,
and uploads `packages/python-mdi-llmkit/dist/*` to PyPI.

.EXAMPLE
.\scripts\release-python.ps1

.EXAMPLE
powershell -File .\scripts\release-python.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$preflightScript = Join-Path $repoRoot "scripts/release-preflight.ps1"
$packageDir = Join-Path $repoRoot "packages/python-mdi-llmkit"

Write-Host "Running release preflight checks..."
& $preflightScript

Push-Location $packageDir
try {
    Write-Host "Publishing Python package from $packageDir"
    python -m pip install --upgrade pip
    python -m pip install hatch twine
    hatch build
    python -m twine check dist/*
    python -m twine upload dist/*
}
finally {
    Pop-Location
}
