param([Parameter(Mandatory=$true)][string]$Config, [switch]$Manager)
$ErrorActionPreference = 'Stop'
# Quote only when needed: wsl.exe treats quoted option names as Linux commands.
function Quote-Argument([string]$Value) {
  if ($Value -match '["\r\n\x00]' -or $Value.EndsWith('\')) { throw 'INVALID_CONFIGURATION' }
  if ($Value -notmatch '\s' -and $Value.Length -gt 0) { return $Value }
  return '"' + $Value + '"'
}
if (-not $Manager) {
  $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + (Quote-Argument $PSCommandPath) + ' -Config ' + (Quote-Argument $Config) + ' -Manager'
  Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
  exit
}
$logDirectory = Join-Path $env:LOCALAPPDATA 'scene-craft\logs'
$logPath = Join-Path $logDirectory ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID + '.log')
$process = $null
$processStarted = $false
$mutex = $null
$ownsMutex = $false
try {
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  # Diagnostic logs contain fixed codes only. Keep 30 days and at most 1 GiB.
  Get-ChildItem $logDirectory -Filter '*.log' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item -ErrorAction SilentlyContinue
  $logs = @(Get-ChildItem $logDirectory -Filter '*.log' | Sort-Object LastWriteTime -Descending)
  [long]$total = 0
  foreach ($log in $logs) { $total += $log.Length; if ($total -gt 1073740800) { Remove-Item $log.FullName -ErrorAction SilentlyContinue } }
  $settings = Get-Content -Raw -Encoding UTF8 $Config | ConvertFrom-Json
  if ($settings.repository -notmatch '^/' -or $settings.node -notmatch '^/' -or $settings.dataDirectory -notmatch '^/' -or $settings.port -lt 1024 -or $settings.port -gt 65535) { throw 'INVALID_CONFIGURATION' }
  $sha = [Security.Cryptography.SHA256]::Create()
  $identity = [Text.Encoding]::UTF8.GetBytes($settings.distribution + '|' + $settings.dataDirectory)
  $mutexName = 'Local\scene-craft-' + ([BitConverter]::ToString($sha.ComputeHash($identity))).Replace('-', '')
  $sha.Dispose()
  $mutex = New-Object System.Threading.Mutex($false, $mutexName)
  try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
  $argsList = @('--distribution', $settings.distribution, '--exec', $settings.node, '--disable-warning=ExperimentalWarning', ($settings.repository.TrimEnd('/') + '/dist/server/cli.js'), '--data-dir', $settings.dataDirectory, '--port', [string]$settings.port)
  if ($settings.fileRoots) { $argsList += @('--file-roots', [string]$settings.fileRoots) }
  if ($settings.gitRepository) { $argsList += @('--git-repository', [string]$settings.gitRepository) }
  if ($settings.codexBinary) { $argsList += @('--codex-binary', [string]$settings.codexBinary) }
  if (-not $ownsMutex) { $argsList += '--probe-only' }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = Join-Path $env:WINDIR 'System32\wsl.exe'
  $info.Arguments = ($argsList | ForEach-Object { Quote-Argument $_ }) -join ' '
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  $process.Start() | Out-Null
  $processStarted = $true
  # Keep this Windows manager and its foreground wsl.exe alive after opening the browser.
  $errors = $process.StandardError.ReadToEndAsync()
  $ready = $process.StandardOutput.ReadLineAsync()
  if (-not $ready.Wait(30000)) { throw 'START_TIMEOUT' }
  $line = $ready.Result
  if (-not $line) {
    $process.WaitForExit()
    $failure = $errors.Result
    if ($failure -match 'PORT_IN_USE') { throw 'PORT_IN_USE' }
    if ($failure -match 'OWNER_NOT_READY') { throw 'OWNER_NOT_READY' }
    throw 'START_FAILED'
  }
  $result = $line | ConvertFrom-Json
  if ($result.status -notin @('started','existing') -or $result.url -notmatch '^http://localhost:[0-9]{4,5}$') { throw 'INVALID_READINESS' }
  Add-Content $logPath ((Get-Date -Format o) + ' ' + $result.status)
  Start-Process $result.url | Out-Null
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'BACKEND_EXITED' }
  Add-Content $logPath ((Get-Date -Format o) + ' stopped')
} catch {
  $code = [string]$_.Exception.Message
  if ($code -notin @('PORT_IN_USE','OWNER_NOT_READY','START_TIMEOUT','INVALID_CONFIGURATION','INVALID_READINESS','BACKEND_EXITED')) { $code = 'START_FAILED' }
  try { Add-Content $logPath ((Get-Date -Format o) + ' ' + $code) } catch {}
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("scene-craft: $code`nLog: $logPath", 'scene-craft') | Out-Null
} finally {
  # Retain wsl.exe even if readiness times out. Never kill unrelated applications.
  if ($processStarted -and -not $process.HasExited) {
    if ($null -ne $ready -and -not $ready.IsCompleted) { $ready.Wait() | Out-Null }
    $remaining = $process.StandardOutput.ReadToEndAsync()
    $process.WaitForExit()
  }
  if ($null -ne $process) { $process.Dispose() }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  if ($null -ne $mutex) { $mutex.Dispose() }
}
