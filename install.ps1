# install.ps1 — PowerShell installer for Bastion AI Gateway
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1 [-Local [path]] [-Remote branch]
param(
    [string]$Local,
    [string]$Remote,
    [switch]$Help
)
$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Usage: install.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Local [path]       Install from local source directory"
    Write-Host "  -Remote <branch>    Install from a specific git branch"
    Write-Host "  -Help               Show this help message"
    exit 0
}

$InstallDir = if ($env:BASTION_INSTALL_DIR) { $env:BASTION_INSTALL_DIR } else { "$env:USERPROFILE\.bastion\app" }
$RepoUrl = if ($env:BASTION_REPO_URL) { $env:BASTION_REPO_URL } else { "https://github.com/aiwatching/bastion.git" }

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "==> $msg" -ForegroundColor Yellow }
function Err($msg) { Write-Host "==> $msg" -ForegroundColor Red; exit 1 }

# --- Pre-checks ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err "Node.js is required. Install it first: https://nodejs.org"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Err "npm is required. Install it with Node.js."
}

$nodeMajor = (node -p "process.versions.node.split('.')[0]") -as [int]
if ($nodeMajor -lt 18) {
    Err "Node.js 18+ required (found v$(node -v))"
}
if ($nodeMajor % 2 -ne 0) {
    Warn "Node.js v$nodeMajor is an odd-numbered (non-LTS) release."
    Warn "Native modules like better-sqlite3 may lack prebuilt binaries."
    Warn "Recommended: use Node.js 22 LTS from https://nodejs.org"
}

Info "Installing Bastion AI Gateway..."

# --- Download / Update ---
if ($Local) {
    # -Local mode: use local source directory
    $LocalSource = if ($Local -eq "True") {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    } else {
        (Resolve-Path $Local).Path
    }
    if (-not (Test-Path "$LocalSource\package.json")) {
        Err "Not a valid Bastion source directory: $LocalSource (no package.json found)"
    }
    if ($LocalSource -eq $InstallDir) {
        Info "Local source is already the install directory"
    } else {
        Info "Installing from local source: $LocalSource"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDir) | Out-Null
        if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
        robocopy $LocalSource $InstallDir /E /XD node_modules .git /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    }
    Push-Location $InstallDir
} elseif ($Remote) {
    # -Remote mode: clone or fetch, then checkout specified branch
    if (Test-Path "$InstallDir\.git") {
        Info "Fetching and switching to branch: $Remote"
        Push-Location $InstallDir
        git fetch origin
        git checkout $Remote 2>$null
        if ($LASTEXITCODE -ne 0) { git checkout -b $Remote "origin/$Remote" }
        git pull origin $Remote --ff-only
    } else {
        Info "Cloning repository (branch: $Remote)..."
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDir) | Out-Null
        if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
        git clone -b $Remote $RepoUrl $InstallDir
        Push-Location $InstallDir
    }
} elseif (Test-Path "$InstallDir\.git") {
    Info "Updating existing installation..."
    Push-Location $InstallDir
    git pull --ff-only
} elseif (Test-Path "$InstallDir\package.json") {
    Info "Using existing source at $InstallDir"
    Push-Location $InstallDir
} else {
    # Check if running from repo directory
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    if ((Test-Path "$ScriptDir\package.json") -and (Select-String -Path "$ScriptDir\package.json" -Pattern "bastion-ai-gateway" -Quiet)) {
        Info "Installing from local source: $ScriptDir"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDir) | Out-Null
        if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
        robocopy $ScriptDir $InstallDir /E /XD node_modules .git /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        Push-Location $InstallDir
    } else {
        Info "Cloning repository..."
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDir) | Out-Null
        git clone $RepoUrl $InstallDir
        Push-Location $InstallDir
    }
}

# --- Install & Build ---
# Temporarily allow non-terminating errors so npm/tsc stderr warnings don't abort
$ErrorActionPreference = "Continue"

Info "Installing dependencies..."
npm install 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Err "npm install failed (exit code $LASTEXITCODE)" }

Info "Building..."
npm run build 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Err "npm run build failed (exit code $LASTEXITCODE)" }

$ErrorActionPreference = "Stop"

# --- Create wrapper batch file ---
$BinDir = "$InstallDir\bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$WrapperContent = @"
@echo off
node "%~dp0\..\dist\cli\index.js" %*
"@
Set-Content -Path "$BinDir\bastion.cmd" -Value $WrapperContent -Encoding ASCII

Pop-Location

# --- Add to user PATH ---
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
    $env:Path = "$env:Path;$BinDir"
    Info "Added $BinDir to user PATH"
}

# --- Verify ---
if (Get-Command bastion -ErrorAction SilentlyContinue) {
    Write-Host ""
    Info "Bastion AI Gateway installed successfully!"
    Write-Host ""
    Write-Host "  Quick start:"
    Write-Host "    bastion start          # Start the gateway"
    Write-Host "    bastion wrap claude     # Run Claude Code through Bastion"
    Write-Host "    bastion wrap <cmd>      # Run any tool through Bastion"
    Write-Host ""
    Write-Host "  PowerShell proxy setup:"
    Write-Host "    bastion proxy on | Invoke-Expression"
    Write-Host ""
    Write-Host "  Dashboard: http://127.0.0.1:8420/dashboard"
    Write-Host ""
} else {
    Warn "Installed but 'bastion' not found in PATH."
    Warn "Restart your terminal or run directly: $BinDir\bastion.cmd"
}
