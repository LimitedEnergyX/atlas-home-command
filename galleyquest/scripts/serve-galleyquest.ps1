<#
  serve-galleyquest.ps1
  Starts GalleyQuest (static site on http://localhost:8000/) as a DETACHED,
  self-surviving python process — modeled on ClearWright's launcher. Run by the
  "GalleyQuest Server" scheduled task, or manually:
      powershell -ExecutionPolicy Bypass -File .\scripts\serve-galleyquest.ps1

  Returns immediately; the server keeps running independently of this launcher.
  (A blocking `& python` child gets reaped by the task's job object seconds after
  it starts — that was the flapping. Start-Process detaches it, like CW does.)
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # repo root (this script lives in scripts\)
$log  = Join-Path $PSScriptRoot 'serve.log'       # launcher events (append)
$out  = Join-Path $PSScriptRoot 'server.out.log'  # server stdout (per launch)
$err  = Join-Path $PSScriptRoot 'server.err.log'  # server stderr (per launch)

# Direct python.exe (NOT the 'py' launcher) so the spawned process IS the server.
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
$py = if ($pyCmd) { $pyCmd.Source } else { 'python' }

# If something already serves :8000, don't spawn a duplicate (it would just fail to bind).
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
    "[$(Get-Date -Format s)] :8000 already serving - nothing to do" | Out-File -FilePath $log -Append -Encoding utf8
    exit 0
}

"[$(Get-Date -Format s)] launching GalleyQuest on http://localhost:8000/  root=$root  via=$py" |
    Out-File -FilePath $log -Append -Encoding utf8

# Detached: survives this launcher exiting AND the scheduled task's job object.
Start-Process -FilePath $py -ArgumentList '-m', 'http.server', '8000' `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err
