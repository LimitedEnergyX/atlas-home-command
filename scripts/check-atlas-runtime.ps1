[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Invoke-AtlasProbe {
    param(
        [string]$Name,
        [string]$Uri,
        [int]$TimeoutSec = 5
    )

    try {
        $body = Invoke-RestMethod -Uri $Uri -TimeoutSec $TimeoutSec
        [pscustomobject]@{
            name = $Name
            reachable = $true
            status = if ($null -ne $body.status) { $body.status } elseif ($null -ne $body.ok) { $body.ok } else { 'ok' }
            detail = if ($null -ne $body.authorization) { $body.authorization } else { $null }
        }
    }
    catch {
        [pscustomobject]@{
            name = $Name
            reachable = $false
            status = 'unavailable'
            detail = $_.Exception.Message
        }
    }
}

$probes = @(
    Invoke-AtlasProbe -Name 'Atlas Home OS' -Uri 'http://127.0.0.1/live'
    Invoke-AtlasProbe -Name 'Atlas core health' -Uri 'http://127.0.0.1/health'
    Invoke-AtlasProbe -Name 'Native Pantry' -Uri 'http://127.0.0.1/v1/galleyquest/status' -TimeoutSec 10
    Invoke-AtlasProbe -Name 'Energy adapter' -Uri 'http://127.0.0.1:17082/api/health'
)

$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(80, 17081, 17082, 17083, 17084, 17085, 17086, 17087) } |
    Sort-Object LocalPort |
    Select-Object LocalAddress, LocalPort, OwningProcess

$monitorLog = 'C:\ProgramData\Atlas\Logs\atlas-overnight-monitor.jsonl'
$latestMonitor = $null
if (Test-Path -LiteralPath $monitorLog) {
    $line = Get-Content -LiteralPath $monitorLog -Tail 1
    if ($line) { $latestMonitor = $line | ConvertFrom-Json }
}

[ordered]@{
    observed_at = (Get-Date).ToString('o')
    probes = $probes
    listeners = @($listeners)
    latest_monitor_sample = $latestMonitor
} | ConvertTo-Json -Depth 8
