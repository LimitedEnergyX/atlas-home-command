Set-StrictMode -Version Latest

function Get-AtlasRecoveryDecision {
    param(
        [bool]$Paused, [bool]$Healthy, [bool]$PortOccupied, [bool]$ProcessPresent,
        [bool]$CircuitOpen, [int]$Attempts, [double]$SecondsSinceAttempt,
        [bool]$StartupReady
    )
    if ($Paused) { return 'paused' }
    if ($Healthy) { return 'healthy' }
    # Never kill a process or compete with another listener automatically.
    if ($PortOccupied -or $ProcessPresent) { return 'unresponsive' }
    if (-not $StartupReady) { return 'waiting-for-startup' }
    if ($CircuitOpen -or $Attempts -ge 3) { return 'circuit-open' }
    $delays = @(15, 30, 120)
    if ($SecondsSinceAttempt -lt $delays[$Attempts]) { return 'backoff' }
    return 'start'
}

function Write-AtlasRecoveryJson {
    param([string]$Path, $Value)
    $temporary = $Path + '.tmp'
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

Export-ModuleMember -Function Get-AtlasRecoveryDecision, Write-AtlasRecoveryJson
