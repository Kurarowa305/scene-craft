$ErrorActionPreference = 'Stop'
$probeRoot = 'C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe'
$probeInfo = Get-Content -Raw (Join-Path $probeRoot 'render-stop-ready.json') | ConvertFrom-Json
$probeProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $probeInfo.pid)
if ($null -eq $probeProcess) { throw 'Probe process already missing' }
if ($probeInfo.token -ne 'scene-craft-issue4-render-stop' -or $probeProcess.ExecutablePath -ne 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -or $probeProcess.CommandLine -notlike '*scene-craft-issue4-probe\render-stop-probe.py*') { throw 'Not the owned probe process' }
$probeStart = $probeProcess.CreationDate.ToString('o')
Stop-Process -Id $probeInfo.pid -Force
Wait-Process -Id $probeInfo.pid -Timeout 10 -ErrorAction SilentlyContinue
@{pid=$probeInfo.pid; creation_time=$probeStart; still_running=[bool](Get-Process -Id $probeInfo.pid -ErrorAction SilentlyContinue); checkpoint_present=(Test-Path (Join-Path $probeRoot 'render-stop-checkpoint.blend')); complete_present=(Test-Path (Join-Path $probeRoot 'render-stop-unexpected-complete.json')); scope='forced termination after render_init; saved checkpoint retained'} | ConvertTo-Json | Set-Content (Join-Path $probeRoot 'render-stop-result.json')
Get-Content (Join-Path $probeRoot 'render-stop-result.json')
