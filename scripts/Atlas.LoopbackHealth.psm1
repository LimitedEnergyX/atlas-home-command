# Public release note: replace the <...> placeholders with your host's own addresses,
# interface aliases, and rule names before use. Values here are examples, not defaults.
function Test-AtlasSupportListener {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Listener, [hashtable]$HaProof = @{}, [hashtable]$LanProof = @{})
    if ($Listener.LocalAddress -in @('127.0.0.1', '::1')) { return $true }
    if ($Listener.LocalPort -ne 17081) { return $false }
    if ($Listener.LocalAddress -eq '<atlas-tailscale-address>') { $proof = $HaProof }
    elseif ($Listener.LocalAddress -eq '<atlas-lan-address>') { $proof = $LanProof }
    else { return $false }
    foreach ($key in @('ForwardMatches', 'RuleMatches', 'InterfaceMatches')) {
        if ($proof[$key] -isnot [bool] -or -not $proof[$key]) { return $false }
    }
    return $true
}

function Get-AtlasHaScopedProof {
    [CmdletBinding()]
    param([string]$LocalAddress, [string]$InterfaceAlias, [string]$RuleName, [string[]]$RemoteAddresses)
    $proof = @{ForwardMatches=$false; RuleMatches=$false; InterfaceMatches=$false}
    try {
        $forward = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\PortProxy\v4tov4\tcp' -ErrorAction Stop
        $proof.ForwardMatches = $forward.PSObject.Properties[($LocalAddress + '/17081')].Value -eq '127.0.0.1/17081'
        $adapter = @(Get-NetAdapter -Name $InterfaceAlias -ErrorAction Stop)
        $addresses = @(Get-NetIPAddress -InterfaceAlias $InterfaceAlias -AddressFamily IPv4 -ErrorAction Stop)
        $proof.InterfaceMatches = $adapter.Count -eq 1 -and [string]$adapter[0].Status -eq 'Up' -and $LocalAddress -in $addresses.IPAddress
        $rule = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $RuleName -ErrorAction Stop)
        if ($rule.Count -ne 1) { return $proof }
        $ports = $rule[0] | Get-NetFirewallPortFilter -ErrorAction Stop
        $address = $rule[0] | Get-NetFirewallAddressFilter -ErrorAction Stop
        $interface = $rule[0] | Get-NetFirewallInterfaceFilter -ErrorAction Stop
        $proof.RuleMatches = [string]$rule[0].Enabled -eq 'True' -and [string]$rule[0].Direction -eq 'Inbound' -and [string]$rule[0].Action -eq 'Allow' `
            -and [string]$ports.Protocol -in @('TCP','6') -and @($ports.LocalPort).Count -eq 1 -and [string]$ports.LocalPort -eq '17081' `
            -and @($address.LocalAddress).Count -eq 1 -and [string]$address.LocalAddress -eq $LocalAddress `
            -and @($address.RemoteAddress).Count -eq 1 -and [string]$address.RemoteAddress -in $RemoteAddresses `
            -and @($interface.InterfaceAlias).Count -eq 1 -and [string]$interface.InterfaceAlias -eq $InterfaceAlias
    } catch {
        # Incomplete evidence never grants an exception.
    }
    return $proof
}
function Get-AtlasHaTailscaleProof {
    Get-AtlasHaScopedProof -LocalAddress '<atlas-tailscale-address>' -InterfaceAlias 'Tailscale' -RuleName 'Atlas-HomeAssistant-Tailscale-17081' -RemoteAddresses @('100.64.0.0/10','100.64.0.0/255.192.0.0')
}
function Get-AtlasHaLanProof {
    Get-AtlasHaScopedProof -LocalAddress '<atlas-lan-address>' -InterfaceAlias '<lan-interface-alias>' -RuleName 'Atlas-HomeAssistant-LAN-17081' -RemoteAddresses @('<lan-subnet>','<lan-subnet-dotted-mask>')
}
Export-ModuleMember -Function Test-AtlasSupportListener, Get-AtlasHaTailscaleProof, Get-AtlasHaLanProof
