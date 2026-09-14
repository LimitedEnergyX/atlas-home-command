[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskName = 'Atlas Runtime Recovery - Current User'
$scriptPath = Join-Path $PSScriptRoot 'watch-atlas-runtime.ps1'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) { throw 'Recovery task already exists. Inspect it before updating; this installer will not overwrite it.' }
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath) `
    -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Bounded, same-user recovery for missing Atlas Home and Energy processes. Never kills hung processes or sends device commands. Respects persistent maintenance pause.' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Installed and started signed-in-user recovery. Pre-login operation is not provided.'
