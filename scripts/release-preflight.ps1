<#
.SYNOPSIS
Validates release prerequisites for mdi-llmkit packages.

.DESCRIPTION
Checks that TypeScript and Python package versions match before publish.
Stops with a non-zero exit if versions are mismatched or cannot be read.

.EXAMPLE
.\scripts\release-preflight.ps1

.EXAMPLE
powershell -File .\scripts\release-preflight.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

$tsPackagePath = Join-Path $repoRoot "packages/typescript-mdi-llmkit/package.json"
$pyProjectPath = Join-Path $repoRoot "packages/python-mdi-llmkit/pyproject.toml"

if (-not (Test-Path $tsPackagePath)) {
    throw "TypeScript package file not found: $tsPackagePath"
}
if (-not (Test-Path $pyProjectPath)) {
    throw "Python project file not found: $pyProjectPath"
}

$tsPackageJson = Get-Content $tsPackagePath -Raw | ConvertFrom-Json
$tsVersion = [string]$tsPackageJson.version
if ([string]::IsNullOrWhiteSpace($tsVersion)) {
    throw "TypeScript package version is missing in $tsPackagePath"
}

$pyProjectText = Get-Content $pyProjectPath -Raw
$pyVersionMatch = [regex]::Match($pyProjectText, '(?m)^version\s*=\s*"(?<version>[^"]+)"')
if (-not $pyVersionMatch.Success) {
    throw "Python project version not found in $pyProjectPath"
}
$pyVersion = [string]$pyVersionMatch.Groups["version"].Value

Write-Host "Preflight: TypeScript version = $tsVersion"
Write-Host "Preflight: Python version     = $pyVersion"

if ($tsVersion -ne $pyVersion) {
    throw "Version mismatch: TypeScript=$tsVersion, Python=$pyVersion"
}

Write-Host "Preflight passed: package versions are aligned."
