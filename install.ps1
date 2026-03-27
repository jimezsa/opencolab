$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$InstallDir = if ($env:OPENCOLAB_INSTALL_DIR) { $env:OPENCOLAB_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "OpenColab\root" }
$PackagePrefix = if ($env:OPENCOLAB_PACKAGE_PREFIX) { $env:OPENCOLAB_PACKAGE_PREFIX } else { Join-Path $env:LOCALAPPDATA "OpenColab\package" }
$BinDir = if ($env:OPENCOLAB_BIN_DIR) { $env:OPENCOLAB_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "OpenColab\bin" }
$PackageSpec = if ($env:OPENCOLAB_PACKAGE_SPEC) { $env:OPENCOLAB_PACKAGE_SPEC } else { "opencolab@latest" }
$SkipDeps = if ($env:OPENCOLAB_SKIP_DEPS) { $env:OPENCOLAB_SKIP_DEPS } else { "0" }
$SkipInit = if ($env:OPENCOLAB_SKIP_INIT) { $env:OPENCOLAB_SKIP_INIT } else { "0" }
$PathUpdated = $false
$PackageCliPath = $null

function Write-Log {
  param([string]$Message)
  Write-Host "[opencolab] $Message"
}

function Write-WarnMessage {
  param([string]$Message)
  Write-Warning "[opencolab] $Message"
}

function Fail {
  param([string]$Message)
  throw "[opencolab] ERROR: $Message"
}

function Get-CommandPath {
  param([string[]]$Names)

  foreach ($name in $Names) {
    $command = Get-Command -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) {
      return $command.Source
    }
  }

  return $null
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $segments = @()

  if ($machinePath) {
    $segments += $machinePath
  }
  if ($userPath) {
    $segments += $userPath
  }

  if ($segments.Count -gt 0) {
    $env:Path = ($segments -join ";")
  }
}

function Get-NodeMajorVersion {
  $nodePath = Get-CommandPath @("node")
  if (-not $nodePath) {
    return 0
  }

  try {
    $version = (& $nodePath -p "process.versions.node.split('.')[0]").Trim()
    return [int]$version
  } catch {
    return 0
  }
}

function Install-Node22 {
  if ((Get-NodeMajorVersion) -ge 22) {
    return
  }

  Write-Log "Installing Node.js 22..."
  $wingetPath = Get-CommandPath @("winget")
  if (-not $wingetPath) {
    Fail "Node.js 22 is required. Install it manually or install winget and rerun."
  }

  & $wingetPath install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Refresh-ProcessPath

  if ((Get-NodeMajorVersion) -lt 22) {
    $commonNodePath = Join-Path $env:ProgramFiles "nodejs\node.exe"
    if (Test-Path $commonNodePath) {
      $env:Path = "$(Split-Path $commonNodePath);$env:Path"
    }
  }

  if ((Get-NodeMajorVersion) -lt 22) {
    Fail "Node.js 22+ is required. Open a new PowerShell window after installation and rerun."
  }
}

function Ensure-Npm {
  if (Get-CommandPath @("npm", "npm.cmd")) {
    return
  }

  Fail "npm is required. Install Node.js 22+ with npm and rerun."
}

function Resolve-PackageCliPath {
  $candidates = @(
    (Join-Path $PackagePrefix "opencolab.cmd"),
    (Join-Path $PackagePrefix "opencolab.ps1"),
    (Join-Path $PackagePrefix "opencolab"),
    (Join-Path $PackagePrefix "bin\opencolab.cmd"),
    (Join-Path $PackagePrefix "bin\opencolab"),
    (Join-Path $PackagePrefix "node_modules\.bin\opencolab.cmd"),
    (Join-Path $PackagePrefix "node_modules\.bin\opencolab")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  Fail "Could not find the installed OpenColab CLI under $PackagePrefix."
}

function Install-Package {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  New-Item -ItemType Directory -Force -Path $PackagePrefix | Out-Null

  Write-Log "Installing $PackageSpec into $PackagePrefix..."
  $npmPath = Get-CommandPath @("npm", "npm.cmd")
  & $npmPath install -g --prefix $PackagePrefix $PackageSpec
  $script:PackageCliPath = Resolve-PackageCliPath
}

function Initialize-Runtime {
  if ($SkipInit -eq "1") {
    return
  }

  Write-Log "Initializing runtime state..."
  $previousRoot = $env:OPENCOLAB_ROOT
  try {
    $env:OPENCOLAB_ROOT = $InstallDir
    & $script:PackageCliPath project list | Out-Null
  } finally {
    if ($null -eq $previousRoot) {
      Remove-Item Env:OPENCOLAB_ROOT -ErrorAction SilentlyContinue
    } else {
      $env:OPENCOLAB_ROOT = $previousRoot
    }
  }
}

function Install-CliShim {
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $shimPath = Join-Path $BinDir "opencolab.cmd"
  $shimContents = @"
@echo off
set "OPENCOLAB_ROOT=$InstallDir"
call "$script:PackageCliPath" %*
"@
  [System.IO.File]::WriteAllText($shimPath, $shimContents, [System.Text.Encoding]::ASCII)
}

function Ensure-BinOnPath {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = @()

  if ($userPath) {
    $entries = $userPath.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)
  }

  foreach ($entry in $entries) {
    if ($entry.TrimEnd("\") -ieq $BinDir.TrimEnd("\")) {
      if ($env:Path -notlike "*$BinDir*") {
        $env:Path = "$BinDir;$env:Path"
      }
      return
    }
  }

  $newUserPath = if ($userPath) { "$BinDir;$userPath" } else { $BinDir }
  [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
  $env:Path = "$BinDir;$env:Path"
  $script:PathUpdated = $true
}

function Main {
  if ($env:OS -ne "Windows_NT") {
    Fail "install.ps1 is for Windows only."
  }

  Write-Log "Detected OS: windows"

  if ($SkipDeps -ne "1") {
    Install-Node22
  }

  Ensure-Npm
  Install-Package
  Initialize-Runtime
  Install-CliShim
  Ensure-BinOnPath

  Write-Host ""
  Write-Host "[opencolab] Installation complete."
  Write-Host "[opencolab] Runtime root: $InstallDir"
  Write-Host "[opencolab] Package prefix: $PackagePrefix"
  Write-Host "[opencolab] Command shim: $(Join-Path $BinDir "opencolab.cmd")"
  Write-Host ""
  Write-Host "Next steps:"
  Write-Host "  opencolab ignite"
  Write-Host "  opencolab gateway start --port 4646"
  Write-Host ""
  Write-WarnMessage "Background gateway service management is currently supported only on macOS and Linux."

  if ($PathUpdated) {
    Write-Host ""
    Write-Host "[opencolab] User PATH was updated."
    Write-Host "[opencolab] Open a new PowerShell window before running:"
    Write-Host "  opencolab ignite"
    Write-Host "  opencolab gateway start --port 4646"
  }
}

Main
