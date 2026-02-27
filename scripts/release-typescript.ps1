<#
.SYNOPSIS
Builds, tests, and publishes the TypeScript package to npm.

.DESCRIPTION
Runs release preflight checks, installs dependencies, builds,
and publishes `packages/typescript-mdi-llmkit`.
Provenance is enabled automatically when running in GitHub Actions.

.EXAMPLE
.\scripts\release-typescript.ps1

.EXAMPLE
powershell -File .\scripts\release-typescript.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-TypeScriptPackageVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageJsonPath
    )

    $packageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
    $version = [string]$packageJson.version
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "Unable to read TypeScript package version from $PackageJsonPath"
    }

    return $version
}

function Invoke-TypeScriptPublishPipeline {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageDir,

        [Parameter(Mandatory = $true)]
        [bool]$UseProvenance
    )

    Push-Location $PackageDir
    try {
        Write-Host "Publishing TypeScript package from $PackageDir"
        npm ci
        npm run build
        if ($UseProvenance) {
            Write-Host "Publishing with npm provenance (GitHub Actions detected)."
            npm publish --access public --provenance
        }
        else {
            Write-Host "Publishing without provenance (local/non-supported provider)."
            npm publish --access public
        }
    }
    finally {
        Pop-Location
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$preflightScript = Join-Path $repoRoot "scripts/release-preflight.ps1"
$packageDir = Join-Path $repoRoot "packages/typescript-mdi-llmkit"
$packageJsonPath = Join-Path $packageDir "package.json"
$targetVersion = Get-TypeScriptPackageVersion -PackageJsonPath $packageJsonPath
$useProvenance = $env:GITHUB_ACTIONS -eq "true"

# 1) Validate release prerequisites.
Write-Host "Running release preflight checks..."
& $preflightScript

# 2) Build, test, and publish package artifacts.
Write-Host "Target TypeScript package version: $targetVersion"
Invoke-TypeScriptPublishPipeline -PackageDir $packageDir -UseProvenance $useProvenance
