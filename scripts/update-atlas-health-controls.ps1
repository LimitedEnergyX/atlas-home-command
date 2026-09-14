# Public release note: replace the <...> placeholders with your host's own addresses,
# interface aliases, and rule names before use. Values here are examples, not defaults.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Atlas.StartupHealth.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'Atlas.LoopbackHealth.psm1') -Force
$logRoot = 'C:\ProgramData\Atlas\Logs'
$logFile = Join-Path $logRoot 'health-check.log'
$startupTaskName = 'Atlas Home OS - Current User Startup'
$supportPorts = @(17081, 17082, 17083, 17084, 17085, 17086, 17087, 11434)
$script:OpenControls = 0

$null = New-Item -ItemType Directory -Force -Path $logRoot
$observed = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + 'Z'

function Write-Control {
    param(
        [Parameter(Mandatory)]
        [string]$Topic,
        [Parameter(Mandatory)]
        [string]$Item,
        [Parameter(Mandatory)]
        [ValidateSet('resolved', 'monitoring', 'open')]
        [string]$State,
        [Parameter(Mandatory)]
        [string]$Detail
    )
    Add-Content -LiteralPath $logFile -Encoding utf8 -Value (
        '{0} {1}/{2} -> {3} ({4})' -f $observed, $Topic, $Item, $State, $Detail
    )
    if ($State -eq 'open') {
        $script:OpenControls++
    }
}

function Test-Endpoint {
    param([Parameter(Mandatory)][string]$Uri)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 4
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

$probes = [ordered]@{
    Atlas_live = 'http://127.0.0.1/live'
    Energy_adapter = 'http://127.0.0.1:17082/api/health'
    HomeAssistant = 'http://127.0.0.1:17081'
    InfluxDB = 'http://127.0.0.1:17083/health'
    Grafana = 'http://127.0.0.1:17084/api/health'
    OpenWebUI = 'http://127.0.0.1:17085/health'
    SearxNG = 'http://127.0.0.1:17086'
    Ntfy = 'http://127.0.0.1:17087/v1/health'
    Ollama = 'http://127.0.0.1:11434/api/tags'
}

$allProbesHealthy = $true
foreach ($probe in $probes.GetEnumerator()) {
    $healthy = Test-Endpoint -Uri $probe.Value
    if (-not $healthy) { $allProbesHealthy = $false }
    Write-Control -Topic monitoring -Item $probe.Key `
        -State $(if ($healthy) { 'resolved' } else { 'open' }) `
        -Detail $(if ($healthy) { 'HTTP probe passed' } else { 'HTTP probe failed' })
}

$expectedContainers = @(
    'atlas-homeassistant',
    'atlas-influxdb',
    'atlas-grafana',
    'atlas-open-webui',
    'atlas-searxng',
    'atlas-ntfy'
)
$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$containerNames = @(& docker ps --format '{{.Names}}' 2>$null)
$dockerExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorPreference
$missingContainers = @($expectedContainers | Where-Object { $_ -notin $containerNames })
$containersHealthy = $dockerExitCode -eq 0 -and $missingContainers.Count -eq 0
Write-Control -Topic system -Item Docker_containers `
    -State $(if ($containersHealthy) { 'resolved' } else { 'open' }) `
    -Detail $(if ($containersHealthy) { 'all 6 expected containers running' } else { "missing=$($missingContainers.Count)" })

try {
    $startupTask = Get-ScheduledTask -TaskName $startupTaskName -ErrorAction Stop
    $startupInfo = Get-ScheduledTaskInfo -TaskName $startupTaskName -ErrorAction Stop
    $bootTime = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime
    $startupControl = Get-AtlasStartupControl -TaskState ([string]$startupTask.State) `
        -LastResult $startupInfo.LastTaskResult -RanThisBoot ($startupInfo.LastRunTime -ge $bootTime) `
        -CurrentServicesHealthy ($allProbesHealthy -and $containersHealthy)
    Write-Control -Topic hygiene -Item Startup_task -State $startupControl.State -Detail $startupControl.Detail
} catch {
    Write-Control -Topic hygiene -Item Startup_task -State open -Detail 'startup task not visible'
}

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $supportPorts -ErrorAction SilentlyContinue)
$haProof = Get-AtlasHaTailscaleProof
$lanProof = Get-AtlasHaLanProof
$unsafeListeners = @($listeners | Where-Object { -not (Test-AtlasSupportListener -Listener $_ -HaProof $haProof -LanProof $lanProof) })
$loopbackListeners = @($listeners | Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1') })
$missingPorts = @($supportPorts | Where-Object { $_ -notin $loopbackListeners.LocalPort })
$approvedHa = @($listeners | Where-Object { $_.LocalAddress -eq '<atlas-tailscale-address>' -and $_.LocalPort -eq 17081 -and (Test-AtlasSupportListener -Listener $_ -HaProof $haProof) })
$approvedLanHa = @($listeners | Where-Object { $_.LocalAddress -eq '<atlas-lan-address>' -and $_.LocalPort -eq 17081 -and (Test-AtlasSupportListener -Listener $_ -LanProof $lanProof) })
$portsHealthy = $unsafeListeners.Count -eq 0 -and $missingPorts.Count -eq 0
Write-Control -Topic network -Item Loopback_services `
    -State $(if ($portsHealthy) { 'resolved' } else { 'open' }) `
    -Detail $(if ($portsHealthy) { "missing=0, unsafe=0; loopback services present; validated HA exceptions: Tailscale=$($approvedHa.Count), LAN=$($approvedLanHa.Count)" } else { "missing=$($missingPorts.Count), unsafe=$($unsafeListeners.Count)" })

$recoveryStatePath = 'C:\ProgramData\Atlas\Runtime\atlas-recovery-state.json'
try {
    $recovery = Get-Content -LiteralPath $recoveryStatePath -Raw | ConvertFrom-Json
    $age = ([DateTimeOffset]::Now - [DateTimeOffset]::Parse($recovery.observed_at)).TotalSeconds
    $recoveryTask = Get-ScheduledTask -TaskName 'Atlas Runtime Recovery - Current User' -ErrorAction Stop
    $problems = @($recovery.services | Where-Object { $_.status -ne 'healthy' })
    $recoveryHealthy = $age -ge 0 -and $age -lt 120 -and $recoveryTask.State -eq 'Running' -and $problems.Count -eq 0
    $detail = if ($recoveryHealthy) { 'supervisor current; both processes responding' } else { 'supervisor stale, paused, or intervention required; inspect atlas-recovery-state.json' }
    Write-Control -Topic monitoring -Item Runtime_recovery -State $(if ($recoveryHealthy) { 'resolved' } else { 'open' }) -Detail $detail
} catch {
    Write-Control -Topic monitoring -Item Runtime_recovery -State open -Detail 'supervisor status unavailable'
}

$lineCount = @(Get-Content -LiteralPath $logFile -ErrorAction SilentlyContinue).Count
if ($lineCount -gt 12000) {
    $retained = Get-Content -LiteralPath $logFile -Tail 9000
    Set-Content -LiteralPath $logFile -Encoding utf8 -Value $retained
}

if ($script:OpenControls -gt 0) {
    exit 1
}
exit 0
