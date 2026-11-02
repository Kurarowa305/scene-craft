param([Parameter(Mandatory=$true)][string]$Config, [string]$EvidenceDirectory = (Join-Path $env:LOCALAPPDATA 'scene-craft\verification'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$settings = Get-Content -Raw -Encoding UTF8 $Config | ConvertFrom-Json
$runId = [Guid]::NewGuid().ToString()
# Use an isolated WSL data directory. Never create test works in production storage.
$settings.dataDirectory = '/tmp/scene-craft-acceptance-' + $runId
# Production fixture stays on Windows; the WSL backend accesses it through its mounted path.
$fileFixture = Join-Path $EvidenceDirectory ($runId + '-files')
$sourceFixture = Join-Path $fileFixture 'source'
$managedFixture = Join-Path $fileFixture 'managed'
New-Item -ItemType Directory -Force $sourceFixture, $managedFixture | Out-Null
[IO.File]::WriteAllText((Join-Path $sourceFixture 'drawing.psd'), 'synthetic saved-file fixture')
$sourceWsl = (& wsl.exe --distribution $settings.distribution --exec wslpath -u $sourceFixture) -join ''
if ($LASTEXITCODE -ne 0) { throw 'Cannot map source fixture to WSL' }
$managedWsl = (& wsl.exe --distribution $settings.distribution --exec wslpath -u $managedFixture) -join ''
if ($LASTEXITCODE -ne 0) { throw 'Cannot map managed fixture to WSL' }
$rootsConfig = Join-Path $fileFixture 'roots.json'
@{sources=@(@{id='acceptance-source'; path=$sourceWsl}); managed=@{id='acceptance-production'; path=$managedWsl}} | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $rootsConfig
$rootsWsl = (& wsl.exe --distribution $settings.distribution --exec wslpath -u $rootsConfig) -join ''
if ($LASTEXITCODE -ne 0) { throw 'Cannot map roots configuration to WSL' }
$settings | Add-Member -NotePropertyName fileRoots -NotePropertyValue $rootsWsl -Force
$testConfig = Join-Path $EvidenceDirectory ($runId + '-config.json')
$settings | ConvertTo-Json | Set-Content -Encoding UTF8 $testConfig
$commit = (& wsl.exe --distribution $settings.distribution --exec git -C $settings.repository rev-parse HEAD) -join ''
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify target commit' }
$dirty = & wsl.exe --distribution $settings.distribution --exec git -C $settings.repository status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit changes and build that commit before verification' }
$nodeVersion = (& wsl.exe --distribution $settings.distribution --exec $settings.node --version) -join ''
$report = [ordered]@{
  commit=$commit; timestamp=(Get-Date -Format o); windows=[Environment]::OSVersion.VersionString
  distribution=$settings.distribution; node=$nodeVersion
  automatic=@(); manual=@(
    @{name='shortcut opens browser'; expected='scene-craft opens in the default browser'; actual=''; status='not_run'; evidence=''},
    @{name='browser and invoking terminal closed'; expected='manager retains wsl.exe; reopen and read same IDs'; actual=''; status='not_run'; evidence=''},
    @{name='duplicate shortcut'; expected='existing instance opens; no second writer'; actual=''; status='not_run'; evidence=''},
    @{name='saved production files'; expected='real saved blend/PSD/PSB and preview import without changing source; before/after and render references survive restart'; actual=''; status='not_run'; evidence=''},
    @{name='Windows copy interruption and mounted drive disconnect'; expected='incomplete or reconciling; previous state retained; same-key retry commits once'; actual=''; status='not_run'; evidence=''},
    @{name='Blender content and dependency inspection'; expected='pending inspection is visible and production remains unavailable until later Blender integration verifies it'; actual=''; status='not_run'; evidence=''},
    @{name='foreign application occupies port'; expected='PORT_IN_USE and log location shown; foreign process stays alive'; actual=''; status='not_run'; evidence=''}
  )
}
$url = 'http://localhost:' + $settings.port
try {
  & (Join-Path $PSScriptRoot 'Launcher.ps1') -Config $testConfig
  $ready = $false
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    try {
      $proof = & wsl.exe --distribution $settings.distribution --exec $settings.node ($settings.repository.TrimEnd('/') + '/dist/server/cli.js') --data-dir $settings.dataDirectory --probe-only
      if ($LASTEXITCODE -eq 0) {
        $verified = $proof | ConvertFrom-Json
        if ($verified.url -eq $url) { $ready=$true; break }
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Backend not ready' }
  $session = Invoke-RestMethod ($url + '/api/session') -SessionVariable webSession
  $headers = @{ Origin=$url; 'x-csrf-token'=$session.csrfToken }
  function Send-RecordOperation([string]$Path, $Body) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
    return Invoke-RestMethod ($url + $Path) -Method Post -WebSession $webSession -Headers $headers -ContentType 'application/json' -Body $bytes
  }
  $work = Send-RecordOperation '/api/works' @{requestKey=([Guid]::NewGuid().ToString()); name='Windows acceptance'; intent='manual verification'}
  $chat = Send-RecordOperation ('/api/works/' + $work.id + '/conversations') @{requestKey=([Guid]::NewGuid().ToString())}
  $body = @{requestKey=([Guid]::NewGuid().ToString()); body="  original text`nsecond line  "}
  $record = Send-RecordOperation ('/api/conversations/' + $chat.id + '/records') $body
  $retry = Send-RecordOperation ('/api/conversations/' + $chat.id + '/records') $body
  $read = @(Invoke-RestMethod ($url + '/api/conversations/' + $chat.id + '/records'))
  if ($retry.id -ne $record.id -or $read.Count -ne 1 -or $read[0].body -cne $body.body) { throw 'Persistence/idempotency mismatch' }
  $report.automatic += @{name='public operations and retransmission'; expected='one unchanged original with same ID'; actual='matched'; status='passed'; evidence=@{workId=$work.id; conversationId=$chat.id; recordId=$record.id}}
  $importBody = @{requestKey=([Guid]::NewGuid().ToString()); body='Windows mounted-file copy'; application='Photoshop'; beforeStateId=$null; files=@(@{rootId='acceptance-source'; relativePath='drawing.psd'; role='psd'})}
  $imported = Send-RecordOperation ('/api/conversations/' + $chat.id + '/imports') $importBody
  $repeated = Send-RecordOperation ('/api/conversations/' + $chat.id + '/imports') $importBody
  $fixed = Join-Path $managedFixture ($imported.state.files[0].relativePath.Replace('/', '\'))
  if ($repeated.state.id -ne $imported.state.id -or [IO.File]::ReadAllText($fixed) -cne 'synthetic saved-file fixture') { throw 'Mounted copy mismatch' }
  [IO.File]::WriteAllText((Join-Path $sourceFixture 'drawing.psd'), 'manual saved-file update')
  $importBody.requestKey = [Guid]::NewGuid().ToString()
  $importBody.beforeStateId = $imported.state.id
  $importBody.body = 'Windows manual change'
  $changed = Send-RecordOperation ('/api/conversations/' + $chat.id + '/imports') $importBody
  if ($changed.state.beforeStateId -ne $imported.state.id -or [IO.File]::ReadAllText($fixed) -cne 'synthetic saved-file fixture') { throw 'Fixed state changed' }
  $report.automatic += @{name='Windows mounted-file copy, same-key retry, fixed before/after'; expected='two states, unchanged original managed bytes'; actual='matched using synthetic file bytes; application contents not validated'; status='passed'; evidence=@{before=$imported.state.id; after=$changed.state.id}}
  Write-Output 'Automatic checks passed. Keep this app running for the manual checks, then use App Exit.'
  Write-Output "Test configuration: $testConfig"
} catch {
  $report.automatic += @{name='public operations and retransmission'; expected='one unchanged original with same ID'; actual='check failed; inspect locally without exporting raw errors'; status='failed'}
  throw 'Windows verification failed. See evidence JSON and launcher logs.'
} finally {
  $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $EvidenceDirectory ($runId + '-result.json'))
}
