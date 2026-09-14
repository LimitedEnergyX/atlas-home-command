function Wait-AtlasReadiness {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Endpoints,
        [ValidateRange(1, 300)][int]$TimeoutSeconds = 120,
        [ValidateRange(1, 10)][int]$IntervalSeconds = 3,
        [scriptblock]$Probe = {
            param($Uri, $Timeout)
            try {
                $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec $Timeout -ErrorAction Stop
                return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
            } catch { return $false }
        },
        [scriptblock]$Clock = { [DateTimeOffset]::UtcNow },
        [scriptblock]$Delay = { param($Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
    )
    $deadline = (& $Clock).AddSeconds($TimeoutSeconds)
    $checks = [ordered]@{}
    foreach ($key in $Endpoints.Keys) { $checks[$key] = $false }
    do {
        foreach ($key in $Endpoints.Keys) {
            if ($checks[$key]) { continue }
            $remaining = ($deadline - (& $Clock)).TotalSeconds
            if ($remaining -le 0) { break }
            $probeTimeout = [Math]::Max(1, [Math]::Min(3, [Math]::Ceiling($remaining)))
            try { $checks[$key] = [bool](& $Probe $Endpoints[$key] $probeTimeout) }
            catch { $checks[$key] = $false }
        }
        if (@($checks.Values | Where-Object { -not $_ }).Count -eq 0) { break }
        $remaining = ($deadline - (& $Clock)).TotalMilliseconds
        if ($remaining -le 0) { break }
        & $Delay ([int][Math]::Min($IntervalSeconds * 1000, $remaining))
    } while ((& $Clock) -lt $deadline)
    return $checks
}

function Get-AtlasStartupControl {
    param(
        [string]$TaskState,
        [long]$LastResult,
        [bool]$RanThisBoot,
        [bool]$CurrentServicesHealthy
    )
    if ($TaskState -eq 'Disabled') {
        return @{ State = 'open'; Detail = 'startup task disabled' }
    }
    if ($TaskState -eq 'Running') {
        return @{ State = 'monitoring'; Detail = 'startup task currently running' }
    }
    if (-not $RanThisBoot) {
        return @{ State = 'open'; Detail = 'startup task has not run since this boot' }
    }
    if ($LastResult -eq 0) {
        return @{ State = 'resolved'; Detail = 'last result 0; live probes reported separately' }
    }
    if ($CurrentServicesHealthy) {
        return @{ State = 'monitoring'; Detail = "historical startup result $LastResult; all current HTTP probes and expected containers pass; startup history retained" }
    }
    return @{ State = 'open'; Detail = "last result $LastResult; current service checks also failing" }
}

Export-ModuleMember -Function Wait-AtlasReadiness, Get-AtlasStartupControl
