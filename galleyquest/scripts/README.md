# scripts

Ops helpers for running GalleyQuest as an always-on local site.

## Keep GalleyQuest running on port 8000 (Windows)

GalleyQuest is a static site, so it needs a small web-server process alive to
answer `http://localhost:8000/`. These scripts register a Scheduled Task that
starts it at logon and restarts it if it ever stops — so it survives reboots
without you babysitting a terminal.

**Install (one time):**

    powershell -ExecutionPolicy Bypass -File .\scripts\install-galleyquest-task.ps1

That registers the task, starts it now, and brings it back on every logon/reboot.
No admin rights needed.

**Files**

- `serve-galleyquest.ps1` — serves the repo root on port 8000 (logs to `serve.log`).
- `install-galleyquest-task.ps1` — registers/updates the `GalleyQuest Server` task.

**Check / control it**

    Get-ScheduledTask   -TaskName 'GalleyQuest Server'
    Start-ScheduledTask -TaskName 'GalleyQuest Server'
    Stop-ScheduledTask  -TaskName 'GalleyQuest Server'

**Remove it**

    Unregister-ScheduledTask -TaskName 'GalleyQuest Server' -Confirm:$false

**Notes**

- If port 8000 is already in use (e.g. a dev server), stop that first; the task
  retries every minute.
- Want it up even when logged out? Re-register the trigger as `-AtStartup` and run
  the task "whether user is logged on or not" (needs admin + stored credentials).
