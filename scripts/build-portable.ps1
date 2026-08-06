[CmdletBinding()]
param(
    [string]$OutputDir = "dist",
    [string]$Python = "python",
    [switch]$SkipInstall,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$venvDir = Join-Path $PSScriptRoot ".portable-build-venv"
$requirements = Join-Path (Get-Location) "requirements.txt"
$outputPath = [System.IO.Path]::GetFullPath(
    (Join-Path (Get-Location) $OutputDir)
)
$workPath = Join-Path (Get-Location) ".portable-build"
$scriptData = Join-Path (Get-Location) "scripts"
$benchmarkData = Join-Path (Get-Location) "benchmark\data\v7"
$exeName = "shieldfont-tools-win64.exe"

if (-not $SkipInstall) {
    if (-not (Test-Path (Join-Path $venvDir "Scripts\python.exe"))) {
        & $Python -m venv $venvDir
    }
    $buildPython = Join-Path $venvDir "Scripts\python.exe"
    & $buildPython -m pip install --disable-pip-version-check --upgrade `
        -r $requirements "pyinstaller==6.21.0"
} else {
    $buildPython = $Python
}

if ($Clean) {
    Remove-Item $workPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $outputPath $exeName) -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force $outputPath | Out-Null

$pyinstaller = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name", "shieldfont-tools-win64",
    "--distpath", $outputPath,
    "--workpath", $workPath,
    "--specpath", $workPath,
    "--paths", $scriptData,
    "--add-data", "$scriptData;scripts",
    "--add-data", "$benchmarkData;benchmark/data/v7",
    "--collect-all", "fontTools",
    "--collect-all", "requests",
    "--collect-all", "uharfbuzz",
    "--collect-all", "brotli",
    "scripts\portable_cli.py"
)
& $buildPython @pyinstaller
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

$exePath = Join-Path $outputPath $exeName
if (-not (Test-Path $exePath)) {
    throw "Portable executable was not created: $exePath"
}

Write-Host "[OK] Created $exePath"
