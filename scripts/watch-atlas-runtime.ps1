[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Atlas.Recovery.psm1') -Force
$root = Split-Path -Parent $PSScriptRoot
$runtime = 'C:\ProgramData\Atlas\Runtime'
$logs = 'C:\ProgramData\Atlas\Logs'
$pausePath = Join-Path $runtime 'atlas-recovery-paused.json'
$statePath = Join-Path $runtime 'atlas-recovery-state.json'
$resetPath = Join-Path $runtime 'atlas-recovery-reset.request'
$logPath = Join-Path $logs 'atlas-recovery.log'
$null = New-Item -ItemType Directory -Force -Path $runtime, $logs
$mutex = [Threading.Mutex]::new($false, 'Local\AtlasRuntimeRecovery')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { exit 0 }
    $definitions = @(
        @{Name='energy'; Port=17082; Url='http://127.0.0.1:17082/api/health'; Image='node.exe'; Entry=(Join-Path $root 'services\powerwall\server.js'); Launcher=(Join-Path $PSScriptRoot 'start-atlas-energy.ps1')},
        @{Name='home'; Port=80; Url='http://127.0.0.1/live'; Image='python.exe'; Entry=(Join-Path $root 'orchestrator\scripts\serve-atlas-current.py'); Launcher=(Join-Path $root 'orchestrator\scripts\start-atlas-home.ps1')}
    )
    $records = @{}
    if (Test-Path -LiteralPath $statePath) {
        # Corrupt state must fail closed, not silently reset the restart budget.
        $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        foreach ($record in $saved.services) { $records[$record.name] = $record }
    }
    foreach ($definition in $definitions) {
        if (-not $records.ContainsKey($definition.Name)) {
            $records[$definition.Name] = [pscustomobject]@{
                name=$definition.Name; status='starting'; attempts=0; circuit_open=$false
                last_attempt=$null; missing_since=$null; healthy_since=$null
                last_transition=$null; last_exit_code=$null; process_id=$null
            }
        }
    }
    $tracked = @{}
    $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
    while ($true) {
        $now = [DateTimeOffset]::Now
        if (Test-Path -LiteralPath $resetPath) {
            foreach ($record in $records.Values) {
                $record.attempts=0; $record.circuit_open=$false; $record.last_attempt=$null
                $record.missing_since=$null; $record.healthy_since=$null
            }
            Remove-Item -LiteralPath $resetPath
        }
        $paused = Test-Path -LiteralPath $pausePath
        $startupTask = Get-ScheduledTask -TaskName 'Atlas Home OS - Current User Startup' -ErrorAction Stop
        $startupInfo = Get-ScheduledTaskInfo -TaskName 'Atlas Home OS - Current User Startup' -ErrorAction Stop
        $startupReady = $startupTask.State -ne 'Running' -and $startupInfo.LastRunTime -gt $boot
        # One inventory per cycle. Command lines are used only for ownership, never logged.
        $processes = @(Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='node.exe'")
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)
        foreach ($definition in $definitions) {
            $record = $records[$definition.Name]
            $owned = @($processes | Where-Object {
                $_.Name -eq $definition.Image -and
                $_.CommandLine -match ('(?:^|[\s\x22])' + [regex]::Escape($definition.Entry) + '(?:$|[\s\x22])')
            })
            $portListeners = @($listeners | Where-Object LocalPort -eq $definition.Port)
            $ownedListener = @($portListeners | Where-Object OwningProcess -in @($owned.ProcessId))
            $healthy = $false
            if ($ownedListener.Count -gt 0) {
                try {
                    $response = Invoke-RestMethod -Uri $definition.Url -TimeoutSec 3
                    $healthy = if ($definition.Name -eq 'home') { $response.status -eq 'alive' } else { $response.adapter -eq 'atlas-energy' -and $response.ok -eq $true }
                } catch { $healthy = $false }
            }
            if ($tracked.ContainsKey($definition.Name)) {
                $previous = $tracked[$definition.Name]
                if ($previous.HasExited) {
                    $record.last_exit_code = $previous.ExitCode
                    $previous.Dispose()
                    $tracked.Remove($definition.Name)
                }
            }
            if ($ownedListener.Count -gt 0 -and -not $tracked.ContainsKey($definition.Name)) {
                try {
                    $attached = Get-Process -Id $ownedListener[0].OwningProcess -ErrorAction Stop
                    $null = $attached.Handle
                    $tracked[$definition.Name] = $attached
                } catch { }
            }
            $record.process_id = if ($ownedListener.Count) { $ownedListener[0].OwningProcess } else { $null }
            if ($healthy) {
                $record.missing_since = $null
                if (-not $record.healthy_since) { $record.healthy_since = $now.ToString('o') }
                # A brief successful restart must not erase a crash-loop budget.
                if (($now - [DateTimeOffset]::Parse($record.healthy_since)).TotalMinutes -ge 15) {
                    $record.attempts = 0; $record.circuit_open = $false; $record.last_attempt = $null
                }
            } else {
                $record.healthy_since = $null
                if (-not $record.missing_since) { $record.missing_since = $now.ToString('o') }
            }
            $reference = if ($record.last_attempt) { $record.last_attempt } else { $record.missing_since }
            $elapsed = if ($reference) { ($now - [DateTimeOffset]::Parse($reference)).TotalSeconds } else { 0 }
            $decision = Get-AtlasRecoveryDecision -Paused $paused -Healthy $healthy `
                -PortOccupied ($portListeners.Count -gt 0) -ProcessPresent ($owned.Count -gt 0) `
                -CircuitOpen $record.circuit_open -Attempts $record.attempts `
                -SecondsSinceAttempt $elapsed -StartupReady $startupReady
            if ($decision -eq 'start') {
                # Recheck pause immediately before starting anything.
                if (Test-Path -LiteralPath $pausePath) { $decision = 'paused' }
                else {
                    $record.attempts++; $record.last_attempt = $now.ToString('o')
                    # Persist before launch so supervisor restarts cannot reset the budget.
                    Write-AtlasRecoveryJson $statePath @{observed_at=$now.ToString('o'); services=@($records.Values)}
                    foreach ($suffix in 'stdout','stderr') {
                        $activeLog = Join-Path $logs "atlas-$($definition.Name)-$suffix.log"
                        if (Test-Path -LiteralPath $activeLog) {
                            Copy-Item -LiteralPath $activeLog -Destination ($activeLog + '.previous') -Force
                        }
                    }
                    $launcherOut = Join-Path $logs "atlas-recovery-$($definition.Name)-launcher.log"
                    $launcherErr = Join-Path $logs "atlas-recovery-$($definition.Name)-launcher-error.log"
                    $launcher = Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
                        -ArgumentList ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $definition.Launcher) `
                        -WindowStyle Hidden -WorkingDirectory $root -PassThru `
                        -RedirectStandardOutput $launcherOut -RedirectStandardError $launcherErr
                    # Retain a handle before waiting; Windows PowerShell otherwise may
                    # lose the exit code for a short-lived Start-Process child.
                    $null = $launcher.Handle
                    if (-not $launcher.WaitForExit(30000)) {
                        # Do not kill a possibly successful child. Inspect next cycle.
                        $decision = 'launcher-timeout'
                    } else {
                        $launcher.Refresh()
                        if ($null -eq $launcher.ExitCode) { $decision = 'launch-exit-unknown' }
                        elseif ($launcher.ExitCode -ne 0) { $decision = 'launch-failed' }
                        else { $decision = 'launched' }
                    }
                    $launcher.Dispose()
                }
            }
            if ($decision -eq 'circuit-open') { $record.circuit_open = $true }
            if ($record.status -ne $decision) {
                if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1048576) {
                    Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force
                }
                Add-Content -LiteralPath $logPath -Value ("{0} {1}: {2} -> {3}; attempts={4}; previous_exit={5}" -f $now.ToString('o'),$definition.Name,$record.status,$decision,$record.attempts,$record.last_exit_code)
                $record.status = $decision; $record.last_transition = $now.ToString('o')
            }
        }
        Write-AtlasRecoveryJson $statePath @{observed_at=[DateTimeOffset]::Now.ToString('o'); services=@($records.Values)}
        Start-Sleep -Seconds 10
    }
} catch {
    # No exception payloads: launcher failures can involve confidential configuration.
    Add-Content -LiteralPath $logPath -Value ("{0} supervisor failed: {1}; line={2}; Task Scheduler will retry within its limit" -f [DateTimeOffset]::Now.ToString('o'), $_.Exception.GetType().Name, $_.InvocationInfo.ScriptLineNumber)
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
