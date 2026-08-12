<#
.SYNOPSIS
Adds or removes LoudEase's trusted automatic-capture flag on the current user's Chrome shortcuts.

.DESCRIPTION
This is a one-time shortcut update, not a resident helper. It never closes Chrome.
Use -WhatIf to preview changes and -Disable to remove the flag again.

.EXAMPLE
.\tools\enable_auto_protection.ps1 -WhatIf

.EXAMPLE
.\tools\enable_auto_protection.ps1 -Disable
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [string]$ExtensionPath,

  [switch]$Disable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Convert-PathToExtensionId {
  param([Parameter(Mandatory = $true)][string]$Path)

  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($resolved)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($bytes)
  } finally {
    $sha256.Dispose()
  }
  $alphabet = 'abcdefghijklmnop'
  $builder = [System.Text.StringBuilder]::new(32)
  foreach ($value in $hash[0..15]) {
    [void]$builder.Append($alphabet[($value -shr 4) -band 0x0f])
    [void]$builder.Append($alphabet[$value -band 0x0f])
  }
  return $builder.ToString()
}

function Find-ChromeExecutable {
  $candidates = @(@(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

  if ($candidates.Count -eq 0) {
    throw 'Google Chrome was not found in the standard install locations.'
  }
  return $candidates[0]
}

$chromeExecutable = Find-ChromeExecutable
if (-not $Disable) {
  if (-not $ExtensionPath) {
    $ExtensionPath = Join-Path $PSScriptRoot '..\dist\github-dev'
  }
  if (-not (Test-Path -LiteralPath $ExtensionPath -PathType Container)) {
    throw "The unpacked extension path does not exist: $ExtensionPath. Run npm run build:dev first or pass -ExtensionPath."
  }
  if (-not $ExtensionId) {
    $ExtensionId = Convert-PathToExtensionId -Path $ExtensionPath
  }
}

$flag = if ($Disable) { '' } else { "--allowlisted-extension-id=$ExtensionId" }
$startMenuDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shortcutPaths = @(
  (Join-Path $startMenuDirectory 'Google Chrome.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Google Chrome.lnk')
)
$shell = New-Object -ComObject WScript.Shell

if (-not (Test-Path -LiteralPath $shortcutPaths[0]) -and -not $Disable) {
  if ($PSCmdlet.ShouldProcess($shortcutPaths[0], 'Create a current-user Google Chrome shortcut')) {
    $shortcut = $shell.CreateShortcut($shortcutPaths[0])
    $shortcut.TargetPath = $chromeExecutable
    $shortcut.WorkingDirectory = Split-Path -Parent $chromeExecutable
    $shortcut.IconLocation = "$chromeExecutable,0"
    $shortcut.Save()
  }
}

$changed = 0
foreach ($shortcutPath in $shortcutPaths) {
  if (-not (Test-Path -LiteralPath $shortcutPath)) {
    continue
  }
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $currentArguments = [string]$shortcut.Arguments
  $cleanArguments = (($currentArguments -replace '(?i)(?:^|\s)--allowlisted-extension-id=[a-p]{32}(?=\s|$)', ' ') -replace '\s{2,}', ' ').Trim()
  $nextArguments = if ($Disable) { $cleanArguments } else { "$cleanArguments $flag".Trim() }
  if ($nextArguments -eq $currentArguments.Trim()) {
    Write-Output "Unchanged: $shortcutPath"
    continue
  }
  $action = if ($Disable) { 'Remove LoudEase automatic protection flag' } else { 'Enable LoudEase automatic protection flag' }
  if ($PSCmdlet.ShouldProcess($shortcutPath, $action)) {
    $shortcut.Arguments = $nextArguments
    $shortcut.Save()
    $changed += 1
    Write-Output "Updated: $shortcutPath"
  }
}

if ($Disable) {
  Write-Output "Automatic protection flag removed from $changed shortcut(s)."
} else {
  Write-Output "LoudEase extension ID: $ExtensionId"
  Write-Output "Automatic protection flag added to $changed shortcut(s)."
}
Write-Output 'Fully exit all Chrome windows, then start Chrome from an updated shortcut for the change to take effect.'
