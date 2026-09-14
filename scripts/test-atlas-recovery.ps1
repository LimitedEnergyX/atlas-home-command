$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Atlas.Recovery.psm1') -Force
function Check($expected, $overrides) {
    $parameters = @{Paused=$false;Healthy=$false;PortOccupied=$false;ProcessPresent=$false;CircuitOpen=$false;Attempts=0;SecondsSinceAttempt=16;StartupReady=$true}
    foreach ($key in $overrides.Keys) { $parameters[$key]=$overrides[$key] }
    $actual = Get-AtlasRecoveryDecision @parameters
    if ($actual -ne $expected) { throw "Expected $expected, got $actual" }
}
Check 'start' @{}
Check 'paused' @{Paused=$true;Healthy=$true}
Check 'healthy' @{Healthy=$true;Attempts=3;CircuitOpen=$true}
Check 'unresponsive' @{PortOccupied=$true}
Check 'unresponsive' @{ProcessPresent=$true}
Check 'waiting-for-startup' @{StartupReady=$false}
Check 'backoff' @{SecondsSinceAttempt=14}
Check 'backoff' @{Attempts=1;SecondsSinceAttempt=29}
Check 'start' @{Attempts=1;SecondsSinceAttempt=30}
Check 'backoff' @{Attempts=2;SecondsSinceAttempt=119}
Check 'start' @{Attempts=2;SecondsSinceAttempt=120}
Check 'circuit-open' @{Attempts=3;SecondsSinceAttempt=9999}
Check 'circuit-open' @{CircuitOpen=$true;SecondsSinceAttempt=9999}
Check 'backoff' @{SecondsSinceAttempt=-10}
Write-Output '14 recovery policy checks passed. No processes or device settings were changed.'
foreach ($expectedExit in @(0, 7)) {
    $process = Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -ArgumentList "-NoProfile -NonInteractive -Command exit $expectedExit" -WindowStyle Hidden -PassThru
    $null = $process.Handle
    if (-not $process.WaitForExit(5000)) { throw 'Harmless child-process test timed out' }
    $process.Refresh()
    if ($process.ExitCode -ne $expectedExit) { throw "Expected child exit $expectedExit, got $($process.ExitCode)" }
    $process.Dispose()
}
Write-Output 'Two harmless child-process exit-code checks passed.'
