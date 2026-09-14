$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Atlas.LoopbackHealth.psm1') -Force
$script:Checks = 0
function Assert-Listener($address, $port, $proof, $expected, $lanProof = @{}) {
    $actual = Test-AtlasSupportListener -Listener ([pscustomobject]@{LocalAddress=$address;LocalPort=$port}) -HaProof $proof -LanProof $lanProof
    if ($actual -ne $expected) { throw "Listener classification failed: $address/$port" }
    $script:Checks++
}
$valid = @{ForwardMatches=$true;RuleMatches=$true;InterfaceMatches=$true}
Assert-Listener '127.0.0.1' 17081 @{} $true
Assert-Listener '::1' 11434 @{} $true
Assert-Listener '<atlas-tailscale-address>' 17081 $valid $true
foreach ($key in @('ForwardMatches','RuleMatches','InterfaceMatches')) {
    $invalid = $valid.Clone(); $invalid[$key] = $false
    Assert-Listener '<atlas-tailscale-address>' 17081 $invalid $false
    $invalid[$key] = 'true'
    Assert-Listener '<atlas-tailscale-address>' 17081 $invalid $false
}
Assert-Listener '<atlas-tailscale-address>' 17081 @{} $false
Assert-Listener '<atlas-tailscale-address>' 11434 $valid $false
Assert-Listener '100.64.0.99' 17081 $valid $false
Assert-Listener '0.0.0.0' 17081 $valid $false
Assert-Listener '::' 17081 $valid $false
Assert-Listener '<atlas-lan-address>' 17081 $valid $false
Assert-Listener '<atlas-lan-address>' 17081 @{} $true $valid
Assert-Listener '<atlas-lan-address>' 17085 @{} $false $valid
Assert-Listener '10.0.0.99' 17081 @{} $false $valid
foreach ($key in @('ForwardMatches','RuleMatches','InterfaceMatches')) {
    $invalid = $valid.Clone(); $invalid[$key] = $false
    Assert-Listener '<atlas-lan-address>' 17081 @{} $false $invalid
}
Write-Output "PASS: $script:Checks listener classification checks, including fail-closed missing/invalid proof."
