$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Atlas.StartupHealth.psm1') -Force
$count = 0
function Assert-Equal($Expected, $Actual) {
    if ($Expected -ne $Actual) { throw "Expected $Expected, got $Actual" }
    $script:count++
}
Assert-Equal 'monitoring' (Get-AtlasStartupControl 'Ready' 1 $true $true).State
Assert-Equal 'open' (Get-AtlasStartupControl 'Ready' 1 $true $false).State
Assert-Equal 'resolved' (Get-AtlasStartupControl 'Ready' 0 $true $true).State
Assert-Equal 'resolved' (Get-AtlasStartupControl 'Ready' 0 $true $false).State
Assert-Equal 'monitoring' (Get-AtlasStartupControl 'Running' 267009 $true $false).State
Assert-Equal 'open' (Get-AtlasStartupControl 'Ready' 0 $false $true).State
Assert-Equal 'open' (Get-AtlasStartupControl 'Disabled' 0 $true $true).State

$simulation = [pscustomobject]@{ Now = [DateTimeOffset]::UtcNow; Probes = 0; Delays = 0 }
$clock = { $simulation.Now }.GetNewClosure()
$delay = { param($ms) $simulation.Now = $simulation.Now.AddMilliseconds($ms); $simulation.Delays++ }.GetNewClosure()
$probe = { param($uri, $timeout) $simulation.Probes++; return $simulation.Probes -ge 3 }.GetNewClosure()
$result = Wait-AtlasReadiness -Endpoints @{service='fake'} -TimeoutSeconds 10 -IntervalSeconds 1 -Clock $clock -Delay $delay -Probe $probe
Assert-Equal $true $result.service
Assert-Equal 3 $simulation.Probes
Assert-Equal 2 $simulation.Delays

$result = Wait-AtlasReadiness -Endpoints @{service='fake'} -TimeoutSeconds 2 -IntervalSeconds 1 -Clock $clock -Delay $delay -Probe { throw 'offline' }
Assert-Equal $false $result.service
$before = $simulation.Delays
$result = Wait-AtlasReadiness -Endpoints @{a='fake-a';b='fake-b'} -Clock $clock -Delay $delay -Probe { $true }
Assert-Equal $true $result.a
Assert-Equal $true $result.b
Assert-Equal $before $simulation.Delays
Write-Output "$count startup health checks passed. No services or device settings changed."
