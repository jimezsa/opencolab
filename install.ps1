$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$InstallMode = "package"
$InstallDir = if ($env:OPENCOLAB_INSTALL_DIR) { $env:OPENCOLAB_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "OpenColab\root" }
$PackagePrefix = if ($env:OPENCOLAB_PACKAGE_PREFIX) { $env:OPENCOLAB_PACKAGE_PREFIX } else { Join-Path $env:LOCALAPPDATA "OpenColab\package" }
$BinDir = if ($env:OPENCOLAB_BIN_DIR) { $env:OPENCOLAB_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "OpenColab\bin" }
$PackageSpec = if ($env:OPENCOLAB_PACKAGE_SPEC) { $env:OPENCOLAB_PACKAGE_SPEC } else { "opencolab@latest" }
$SourceDir = if ($env:OPENCOLAB_CLONE_DIR) { $env:OPENCOLAB_CLONE_DIR } else { Join-Path $env:LOCALAPPDATA "OpenColab\source" }
$RepoUrl = if ($env:OPENCOLAB_REPO_URL) { $env:OPENCOLAB_REPO_URL } else { "https://github.com/jimezsa/opencolab.git" }
$Branch = if ($env:OPENCOLAB_BRANCH) { $env:OPENCOLAB_BRANCH } else { "main" }
$PnpmVersion = if ($env:OPENCOLAB_PNPM_VERSION) { $env:OPENCOLAB_PNPM_VERSION } else { "9.15.5" }
$SkipDeps = if ($env:OPENCOLAB_SKIP_DEPS) { $env:OPENCOLAB_SKIP_DEPS } else { "0" }
$SkipInit = if ($env:OPENCOLAB_SKIP_INIT) { $env:OPENCOLAB_SKIP_INIT } else { "0" }
$PathUpdated = $false
$PackageCliPath = $null
$CloneCliPath = $null

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

function Parse-Args {
  param([string[]]$InstallerArgs)

  foreach ($arg in $InstallerArgs) {
    switch ($arg) {
      "--hacky" { $script:InstallMode = "clone" }
      default { Fail "Unsupported installer argument '$arg'. Supported flags: --hacky" }
    }
  }
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
  $nodePath = Get-CommandPath @("node", "node.exe")
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

function Install-Git {
  if (Get-CommandPath @("git", "git.exe")) {
    return
  }

  Write-Log "Installing git..."
  $wingetPath = Get-CommandPath @("winget")
  if (-not $wingetPath) {
    Fail "git is required for clone mode. Install Git for Windows or install winget and rerun."
  }

  & $wingetPath install -e --id Git.Git --accept-source-agreements --accept-package-agreements
  Refresh-ProcessPath

  if (-not (Get-CommandPath @("git", "git.exe"))) {
    $commonGitPath = Join-Path ${env:ProgramFiles} "Git\cmd\git.exe"
    if (Test-Path $commonGitPath) {
      $env:Path = "$(Split-Path $commonGitPath);$env:Path"
    }
  }

  if (-not (Get-CommandPath @("git", "git.exe"))) {
    Fail "git installation failed."
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

function Ensure-Pnpm {
  if (Get-CommandPath @("pnpm", "pnpm.cmd")) {
    return
  }

  Write-Log "Installing pnpm..."
  $corepackPath = Get-CommandPath @("corepack", "corepack.cmd")
  if ($corepackPath) {
    & $corepackPath enable
    & $corepackPath prepare "pnpm@$PnpmVersion" --activate
    Refresh-ProcessPath
  } else {
    $npmPath = Get-CommandPath @("npm", "npm.cmd")
    if (-not $npmPath) {
      Fail "Could not install pnpm (missing corepack and npm)."
    }
    & $npmPath install -g "pnpm@$PnpmVersion"
    Refresh-ProcessPath
  }

  if (-not (Get-CommandPath @("pnpm", "pnpm.cmd"))) {
    Fail "pnpm installation failed."
  }
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

function Resolve-CloneCliPath {
  $candidate = Join-Path $SourceDir "dist\src\cli.js"
  if (Test-Path $candidate) {
    return $candidate
  }

  Fail "Could not find the built OpenColab CLI under $SourceDir."
}

function Clone-OrUpdateRepo {
  $gitPath = Get-CommandPath @("git", "git.exe")
  if (-not $gitPath) {
    Fail "git is required for clone mode."
  }

  $gitDir = Join-Path $SourceDir ".git"
  if (Test-Path $gitDir) {
    Write-Log "Updating existing repository at $SourceDir..."
    & $gitPath -C $SourceDir fetch --depth=1 origin $Branch
    & $gitPath -C $SourceDir checkout $Branch
    & $gitPath -C $SourceDir pull --ff-only origin $Branch
    return
  }

  if ((Test-Path $SourceDir) -and (Get-ChildItem -Force -Path $SourceDir | Select-Object -First 1)) {
    Fail "Clone directory '$SourceDir' exists and is not empty."
  }

  Write-Log "Cloning repository to $SourceDir..."
  New-Item -ItemType Directory -Force -Path (Split-Path $SourceDir -Parent) | Out-Null
  & $gitPath clone --depth=1 --branch $Branch $RepoUrl $SourceDir
}

function Install-CloneProject {
  $pnpmPath = Get-CommandPath @("pnpm", "pnpm.cmd")
  if (-not $pnpmPath) {
    Fail "pnpm is required for clone mode."
  }

  Push-Location $SourceDir
  try {
    Write-Log "Installing dependencies in $SourceDir..."
    try {
      & $pnpmPath install --frozen-lockfile
    } catch {
      Write-WarnMessage "Falling back to 'pnpm install' because lockfile install failed."
      & $pnpmPath install
    }

    Write-Log "Building project..."
    & $pnpmPath run build
  } finally {
    Pop-Location
  }

  $script:CloneCliPath = Resolve-CloneCliPath
}

function Invoke-InstalledCli {
  param([string[]]$Arguments)

  if ($script:InstallMode -eq "clone") {
    $nodePath = Get-CommandPath @("node", "node.exe")
    if (-not $nodePath) {
      Fail "Node.js 22+ is required."
    }
    & $nodePath $script:CloneCliPath @Arguments
    return
  }

  & $script:PackageCliPath @Arguments
}

function Initialize-Runtime {
  if ($SkipInit -eq "1") {
    return
  }

  Write-Log "Initializing runtime state..."
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $previousRoot = $env:OPENCOLAB_ROOT
  try {
    $env:OPENCOLAB_ROOT = $InstallDir
    Invoke-InstalledCli -Arguments @("project", "list") | Out-Null
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
  if ($script:InstallMode -eq "clone") {
    $shimContents = @"
@echo off
set "OPENCOLAB_ROOT=$InstallDir"
node "$script:CloneCliPath" %*
"@
  } else {
    $shimContents = @"
@echo off
set "OPENCOLAB_ROOT=$InstallDir"
call "$script:PackageCliPath" %*
"@
  }
  [System.IO.File]::WriteAllText($shimPath, $shimContents, [System.Text.Encoding]::ASCII)
}

function Write-ManagedInstallManifest {
  $manifestDir = Join-Path $InstallDir ".opencolab"
  $manifestPath = Join-Path $manifestDir "install.json"
  New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null

  $manifest = [ordered]@{
    version = 1
    manager = "one_link"
    installMode = $script:InstallMode
    runtimeRoot = $InstallDir
    packageSpec = if ($script:InstallMode -eq "clone") { $null } else { $PackageSpec }
    packagePrefix = if ($script:InstallMode -eq "clone") { $null } else { $PackagePrefix }
    sourceDir = if ($script:InstallMode -eq "clone") { $SourceDir } else { $null }
    repoUrl = if ($script:InstallMode -eq "clone") { $RepoUrl } else { $null }
    branch = if ($script:InstallMode -eq "clone") { $Branch } else { $null }
    shimPath = Join-Path $BinDir "opencolab.cmd"
  }
  [System.IO.File]::WriteAllText(
    $manifestPath,
    (($manifest | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
    [System.Text.Encoding]::ASCII
  )
}

function Warn-IfShimShadowed {
  $command = Get-Command -Name "opencolab" -ErrorAction SilentlyContinue | Select-Object -First 1
  $shimPath = Join-Path $BinDir "opencolab.cmd"
  if ($null -ne $command -and $command.Source -and $command.Source -ine $shimPath) {
    Write-WarnMessage "Another 'opencolab' command appears earlier on PATH: $($command.Source)"
    Write-WarnMessage "The installer-managed shim is $shimPath"
  }
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

  Parse-Args $args
  Write-Log "Detected OS: windows"
  Write-Log "Install mode: $script:InstallMode"

  if ($SkipDeps -ne "1") {
    Install-Node22
    if ($script:InstallMode -eq "clone") {
      Install-Git
      Ensure-Pnpm
    }
  }

  if ((Get-NodeMajorVersion) -lt 22) {
    Fail "Node.js 22+ is required."
  }

  if ($script:InstallMode -eq "clone") {
    if (-not (Get-CommandPath @("git", "git.exe"))) {
      Fail "git is required for clone mode. Install git or rerun without --hacky."
    }
    if (-not (Get-CommandPath @("pnpm", "pnpm.cmd"))) {
      Fail "pnpm is required for clone mode. Install pnpm or rerun without OPENCOLAB_SKIP_DEPS=1."
    }
    Clone-OrUpdateRepo
    Install-CloneProject
  } else {
    Ensure-Npm
    Install-Package
  }

  Initialize-Runtime
  Install-CliShim
  Write-ManagedInstallManifest
  Ensure-BinOnPath
  Warn-IfShimShadowed

  Write-Host ""
  Write-Host "[opencolab] Installation complete."
  Write-Host "[opencolab] Install mode: $script:InstallMode"
  Write-Host "[opencolab] Runtime root: $InstallDir"
  if ($script:InstallMode -eq "clone") {
    Write-WarnMessage "Clone mode is a hacky fallback. The shim runs a locally built checkout from $SourceDir."
    Write-Host "[opencolab] Source checkout: $SourceDir"
  } else {
    Write-Host "[opencolab] Package prefix: $PackagePrefix"
  }
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
