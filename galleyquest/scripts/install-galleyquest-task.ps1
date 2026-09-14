<#
  install-galleyquest-task.ps1
  Registers a Windows Scheduled Task that keeps GalleyQuest serving on port 8000,
  starting at every logon and restarting automatically if it stops. Re-run any time
  to update it. No admin rights required (runs in your own session at logon).

      powershell -ExecutionPolicy Bypass -File .\scripts\install-galleyquest-task.ps1

  To remove it later:
      Unregister-ScheduledTask -TaskName 'GalleyQuest Server' -Confirm:$false
#>
$ErrorActionPreference = 'Stop'
$taskName = 'GalleyQuest Server'
$runner   = Join-Path $PSScriptRoot 'serve-galleyquest.ps1'
if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "[ok] Registered scheduled task '$taskName' (runs at logon, restarts on failure)."

Start-ScheduledTask -TaskName $taskName
Write-Host "[ok] Started. GalleyQuest should now be live at http://localhost:8000/"
Write-Host "     If port 8000 is already in use, stop that server first; the task retries every minute."
