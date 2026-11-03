param()
$ErrorActionPreference = 'Stop'
$install = Join-Path $env:LOCALAPPDATA 'scene-craft'
$config = Join-Path $install 'launcher.json'
if (-not (Test-Path -LiteralPath $config)) { throw 'Run Install-Shortcut.ps1 first.' }
# Updating launch scripts preserves the existing storage, authentication and Git settings.
foreach ($name in @('Launcher.ps1','Test-Local.ps1','Update-Installation.ps1')) {
  $source = Join-Path $PSScriptRoot $name
  $destination = Join-Path $install $name
  if ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($destination)) {
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
}
Write-Output 'Updated Windows scripts. Close scene-craft with App Exit, then launch its shortcut to build the checkout and restart.'
