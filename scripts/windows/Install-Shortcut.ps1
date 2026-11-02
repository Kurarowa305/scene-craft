param(
  [Parameter(Mandatory=$true)][string]$Distribution,
  [Parameter(Mandatory=$true)][string]$WslNode,
  [Parameter(Mandatory=$true)][string]$WslRepository,
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [ValidateRange(1024,65535)][int]$Port = 4317
)
$ErrorActionPreference = 'Stop'
$install = Join-Path $env:LOCALAPPDATA 'scene-craft'
New-Item -ItemType Directory -Force -Path $install | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'Launcher.ps1') (Join-Path $install 'Launcher.ps1') -Force
$config = Join-Path $install 'launcher.json'
@{ distribution=$Distribution; node=$WslNode; repository=$WslRepository; dataDirectory=$DataDirectory; port=$Port } | ConvertTo-Json | Set-Content -Encoding UTF8 $config
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'scene-craft.lnk'))
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $install 'Launcher.ps1') + '" -Config "' + $config + '"'
$shortcut.WorkingDirectory = $install
$shortcut.Description = 'scene-craft - local production notes'
$shortcut.Save()
Write-Output "Created shortcut. Configuration: $config"
