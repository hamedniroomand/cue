#Requires -Version 5.1
<#
Install the cue CLI on Windows from GitHub Releases.
  powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/OWNER/REPO/main/install.ps1 | iex"
Options (env vars):
  CUE_REPO     owner/repo to download from (default below)
  CUE_VERSION  release tag, e.g. v0.2.0 (default: latest)
  CUE_BIN_DIR  install directory (default: %LOCALAPPDATA%\Programs\cue)
#>
$ErrorActionPreference = "Stop"

$Repo = if ($env:CUE_REPO) { $env:CUE_REPO } else { "hamedniroomand/cue" }
$Version = if ($env:CUE_VERSION) { $env:CUE_VERSION } else { "latest" }
$BinDir = if ($env:CUE_BIN_DIR) { $env:CUE_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\cue" }

# x64 binary only: Windows 11 on ARM runs it through x64 emulation.
$Asset = "cue-windows-x64.exe"
$Base = if ($Version -eq "latest") {
  "https://github.com/$Repo/releases/latest/download"
} else {
  "https://github.com/$Repo/releases/download/$Version"
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("cue-install-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Write-Host "downloading $Asset ($Version) from $Repo (~60MB)..."
  Invoke-WebRequest -Uri "$Base/$Asset" -OutFile (Join-Path $Tmp "cue.exe")
  Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile (Join-Path $Tmp "checksums.txt")

  $Line = Get-Content (Join-Path $Tmp "checksums.txt") | Where-Object { $_ -match [regex]::Escape($Asset) + "$" }
  if (-not $Line) { throw "checksum for $Asset not found in checksums.txt - refusing to install" }
  $Expected = ($Line -split "\s+")[0].ToLower()
  $Actual = (Get-FileHash (Join-Path $Tmp "cue.exe") -Algorithm SHA256).Hash.ToLower()
  if ($Expected -ne $Actual) { throw "checksum mismatch - refusing to install" }

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Move-Item -Force (Join-Path $Tmp "cue.exe") (Join-Path $BinDir "cue.exe")
  $InstalledVersion = & (Join-Path $BinDir "cue.exe") --version
  Write-Host "installed $BinDir\cue.exe ($InstalledVersion)"

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($UserPath -split ";") -notcontains $BinDir) {
    Write-Host ""
    Write-Host "note: $BinDir is not on your PATH. Add it with:"
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$BinDir;`" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
    Write-Host "then open a new terminal."
  }

  Write-Host ""
  Write-Host "next steps: install and authenticate the 'gh' and 'claude' CLIs, then run"
  Write-Host "'cue init' inside a target repo."
  Write-Host "Docs: https://hamedniroomand.github.io/cue/"
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
