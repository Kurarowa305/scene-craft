param()
$ErrorActionPreference = 'Stop'
$install = Join-Path $env:LOCALAPPDATA 'scene-craft'
$config = Join-Path $install 'launcher.json'
if (-not (Test-Path -LiteralPath $config)) { throw 'Run Install-Shortcut.ps1 first.' }
$sourceRoot = $PSScriptRoot
if ([IO.Path]::GetFullPath($PSScriptRoot) -eq [IO.Path]::GetFullPath($install)) {
  $settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $config | ConvertFrom-Json
  $repositoryPath = $settings.repository.TrimStart('/').Replace('/', '\')
  $sourceRoot = Join-Path (Join-Path ('\\wsl.localhost\' + $settings.distribution) $repositoryPath) 'scripts\windows'
}
# Updating launch scripts preserves the existing storage, authentication and Git settings.
foreach ($name in @('Launcher.ps1','Test-Local.ps1','Update-Installation.ps1')) {
  $source = Join-Path $sourceRoot $name
  $destination = Join-Path $install $name
  if ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($destination)) {
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
}
Write-Output 'Updated Windows scripts. Close scene-craft with App Exit, then launch its shortcut to build the checkout and restart.'
