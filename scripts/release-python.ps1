<#
.SYNOPSIS
Builds, validates, and publishes the Python package to PyPI.

.DESCRIPTION
Runs release preflight checks, builds with Hatch, validates artifacts with Twine,
and uploads `packages/python-mdi-llmkit/dist/*` to PyPI.
The script clears `dist` first to avoid uploading stale artifacts.
After upload, it verifies the target version is visible on PyPI with delayed retries.

.EXAMPLE
.\scripts\release-python.ps1

.EXAMPLE
powershell -File .\scripts\release-python.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-PythonPackageVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PyProjectPath
    )

    $pyProjectText = Get-Content $PyProjectPath -Raw
    $versionMatch = [regex]::Match($pyProjectText, '(?m)^version\s*=\s*"(?<version>[^"]+)"')
    if (-not $versionMatch.Success) {
        throw "Unable to read Python package version from $PyProjectPath"
    }

    return [string]$versionMatch.Groups["version"].Value
}

function Confirm-PyPIVersionVisible {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageName,

        [Parameter(Mandatory = $true)]
        [string]$Version,

        [Parameter(Mandatory = $true)]
        [int]$Attempts,

        [Parameter(Mandatory = $true)]
        [int]$DelaySeconds
    )

    $pypiJsonUrl = "https://pypi.org/pypi/$PackageName/json"

    Write-Host "Waiting $DelaySeconds seconds before first PyPI verification check..."
    Start-Sleep -Seconds $DelaySeconds

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        Write-Host "PyPI verification attempt $attempt/$Attempts for version $Version..."
        try {
            $pypiResponse = Invoke-RestMethod -Uri $pypiJsonUrl -Method Get
            $availableVersions = $pypiResponse.releases.PSObject.Properties.Name
            if ($availableVersions -contains $Version) {
                Write-Host "PyPI verification passed: $PackageName $Version is visible."
                return
            }
        }
        catch {
            Write-Warning "PyPI verification request failed: $($_.Exception.Message)"
        }

        if ($attempt -lt $Attempts) {
            Write-Host "Version not visible yet. Waiting $DelaySeconds seconds before retry..."
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    throw "PyPI verification failed: $PackageName $Version not visible after $Attempts attempts."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$preflightScript = Join-Path $repoRoot "scripts/release-preflight.ps1"
$packageDir = Join-Path $repoRoot "packages/python-mdi-llmkit"
$pyProjectPath = Join-Path $packageDir "pyproject.toml"

$verificationAttempts = 5
$verificationDelaySeconds = 60
$pypiPackageName = "mdi-llmkit"

$targetVersion = Get-PythonPackageVersion -PyProjectPath $pyProjectPath

# 1) Validate release prerequisites.
Write-Host "Running release preflight checks..."
& $preflightScript

# 2) Build and publish package artifacts.
Push-Location $packageDir
try {
    Write-Host "Publishing Python package from $packageDir"
    if (Test-Path "dist") {
        Write-Host "Removing existing dist directory to avoid stale uploads..."
        Remove-Item "dist" -Recurse -Force
    }
    python -m pip install --upgrade pip
    python -m pip install hatch twine
    hatch build
    python -m twine check dist/*
    python -m twine upload dist/*
}
finally {
    Pop-Location
}

# 3) Verify published version is visible on PyPI.
Confirm-PyPIVersionVisible `
    -PackageName $pypiPackageName `
    -Version $targetVersion `
    -Attempts $verificationAttempts `
    -DelaySeconds $verificationDelaySeconds
