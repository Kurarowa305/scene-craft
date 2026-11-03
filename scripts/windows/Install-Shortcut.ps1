param(
  [Parameter(Mandatory=$true)][string]$Distribution,
  [Parameter(Mandatory=$true)][string]$WslNode,
  [Parameter(Mandatory=$true)][string]$WslRepository,
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [ValidateRange(1024,65535)][int]$Port = 4317,
  [string]$CodexBinary,
  [string]$GitRepository,
  [string]$FileRoots
)
$ErrorActionPreference = 'Stop'
$install = Join-Path $env:LOCALAPPDATA 'scene-craft'
New-Item -ItemType Directory -Force -Path $install | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'Launcher.ps1') (Join-Path $install 'Launcher.ps1') -Force
Copy-Item (Join-Path $PSScriptRoot 'Test-Local.ps1') (Join-Path $install 'Test-Local.ps1') -Force
$config = Join-Path $install 'launcher.json'
# Keep optional settings when refreshing an existing shortcut.
$settings = @{}
if (Test-Path -LiteralPath $config) {
  $previous = Get-Content -Raw -Encoding UTF8 -LiteralPath $config | ConvertFrom-Json
  foreach ($property in $previous.PSObject.Properties) { $settings[$property.Name] = $property.Value }
}
$settings.distribution=$Distribution; $settings.node=$WslNode; $settings.repository=$WslRepository; $settings.dataDirectory=$DataDirectory; $settings.port=$Port
if ($CodexBinary) { $settings.codexBinary=$CodexBinary }
if ($GitRepository) { $settings.gitRepository=$GitRepository }
if ($FileRoots) { $settings.fileRoots=$FileRoots }
$settings | ConvertTo-Json | Set-Content -Encoding UTF8 $config
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'scene-craft.lnk'))
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $install 'Launcher.ps1') + '" -Config "' + $config + '"'
$shortcut.WorkingDirectory = $install
$shortcut.Description = 'scene-craft - local production notes'
$shortcut.Save()
Write-Output "Created shortcut. Configuration: $config"
