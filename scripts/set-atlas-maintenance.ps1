[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Pause','Resume','Status')][string]$Mode)
$ErrorActionPreference = 'Stop'
$runtime = 'C:\ProgramData\Atlas\Runtime'
$pause = Join-Path $runtime 'atlas-recovery-paused.json'
$taskName = 'Atlas Runtime Recovery - Current User'
Import-Module (Join-Path $PSScriptRoot 'Atlas.Recovery.psm1') -Force
if ($Mode -eq 'Status') {
    Write-Output ('Maintenance paused: ' + (Test-Path -LiteralPath $pause))
    Get-Content -LiteralPath (Join-Path $runtime 'atlas-recovery-state.json') -ErrorAction SilentlyContinue
    return
}
$null = New-Item -ItemType Directory -Force -Path $runtime
if ($Mode -eq 'Pause') {
    Write-AtlasRecoveryJson $pause @{paused_at=[DateTimeOffset]::Now.ToString('o'); reason='Planned maintenance'; resume='Run set-atlas-maintenance.ps1 -Mode Resume'}
    # Drain any launcher already in progress, including an independent startup task.
    # New launchers see the marker and return without starting a process.
    foreach ($mutexName in @('Local\AtlasEnergyLaunch','Local\AtlasHomeLaunch')) {
        $barrier = [Threading.Mutex]::new($false, $mutexName)
        $acquired = $false
        try {
            try { $acquired = $barrier.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $acquired = $true }
            if (-not $acquired) { throw 'Pause marker set, but an Atlas launcher is still running. Do not stop services yet.' }
        } finally {
            if ($acquired) { $barrier.ReleaseMutex() }
            $barrier.Dispose()
        }
    }
    # Do not stop the scheduled task: Windows may terminate its descendant services.
    # Wait for any in-flight launch to finish and the supervisor to acknowledge pause.
    $deadline = (Get-Date).AddSeconds(50)
    do {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
        if ($task.State -ne 'Running') { break }
        $statePath = Join-Path $runtime 'atlas-recovery-state.json'
        $state = if (Test-Path $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
        if ($state -and @($state.services | Where-Object status -ne 'paused').Count -eq 0) { break }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    if ($task.State -eq 'Running' -and (-not $state -or @($state.services | Where-Object status -ne 'paused').Count -gt 0)) {
        throw 'Pause marker is set, but the supervisor did not acknowledge it. Do not stop services until this is resolved.'
    }
    Write-Output 'Recovery paused persistently. Existing Atlas processes are unchanged. Pause before stopping them for maintenance.'
} else {
    # Preserve incident evidence. Supervisor consumes the explicit budget-reset request.
    $state = Join-Path $runtime 'atlas-recovery-state.json'
    if (Test-Path -LiteralPath $state) {
        Copy-Item -LiteralPath $state -Destination ($state + '.' + (Get-Date -Format 'yyyyMMddHHmmssfff') + '.previous')
    }
    Write-AtlasRecoveryJson (Join-Path $runtime 'atlas-recovery-reset.request') @{requested_at=[DateTimeOffset]::Now.ToString('o')}
    if (Test-Path -LiteralPath $pause) { Remove-Item -LiteralPath $pause }
    Start-ScheduledTask -TaskName $taskName
    Write-Output 'Recovery resumed. Missing processes may start; household device settings are unchanged.'
}
