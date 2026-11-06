# Atlas runtime recovery

## Scope

`Atlas Runtime Recovery - Current User` is a long-running Windows scheduled task,
not a Windows service. It runs as the existing signed-in user with limited rights.
It is independent of the Codex conversation, and uses the existing launchers and
Windows Credential Manager. No credentials are copied to task definitions or files.
It does not run before sign-in or guarantee operation after sign-out. Docker Desktop
and the existing startup task also retain their current sign-in dependencies.

The startup task remains responsible for Docker, Ollama, and initial startup.
The supervisor waits until that task has run since the current boot and is no longer
running. It does not change firewall, remote-write policy, or household device settings.

## Recovery policy

- Inspect exact Atlas entrypoint process identities and listening ports every 10 seconds.
- Probe only local `/live` and `/api/health`. Tesla authorization, upstream connectivity,
  and sensor availability are not process-failure triggers.
- Missing process: start after a 15-second observation delay. Allow at most three
  attempts, separated by minimum delays of 30 seconds and 120 seconds after failures.
- Retry state is persisted before launch and survives a supervisor restart.
- Stop retrying after three attempts. Resume explicitly resets this budget. Fifteen
  continuous minutes of successful health probes also resets the budget.
- Occupied port or a matching process without a healthy endpoint: report unresponsive;
  do not kill, restart, or duplicate it automatically.
- Launch mutexes prevent competing invocations of the same launcher.
- Record exit codes when obtainable from an attached process handle, plus state
  transitions. An exit code does not identify who or what terminated a process.
- Task Scheduler retries a failed supervisor three times at one-minute intervals.
  No recurring fallback task silently resets this limit.

## Maintenance and planned shutdown

Before stopping Atlas for an update or shutdown:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <atlas-source-root>\scripts\set-atlas-maintenance.ps1 -Mode Pause
```

Wait for the successful pause acknowledgement before stopping services. This leaves
running Atlas services alone and suppresses further launches, including launches by
the startup task. It does not itself stop services or Docker containers. The pause
persists across reboot, so Atlas Home and Energy will stay paused until resumed.
Other Docker/Ollama dependencies follow their existing startup behavior.

After maintenance:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <atlas-source-root>\scripts\set-atlas-maintenance.ps1 -Mode Resume
```

Inspect status with `-Mode Status`. Resume archives the previous state, resets the
retry budget explicitly, removes the maintenance marker, and starts the task if needed.
Do not use `Stop-ScheduledTask` as an ordinary maintenance pause: Windows may also
terminate processes descended from a task.

## Evidence and limits

- State: `C:\ProgramData\Atlas\Runtime\atlas-recovery-state.json`
- Maintenance flag: `C:\ProgramData\Atlas\Runtime\atlas-recovery-paused.json`
- Transitions: `C:\ProgramData\Atlas\Logs\atlas-recovery.log`
- Transition log rolls over at 1 MiB, retaining one previous file.
- A recovery launch preserves the previous stdout/stderr logs as `.previous`.
- Launcher logs contain local troubleshooting information and must remain private.
- The existing 20-minute health check now also records stale, paused, or unhealthy
  recovery state. This is local evidence, not a newly configured push notification.
- Health-check timestamps are now genuine UTC. Older entries incorrectly appended Z
  to local time and must be interpreted with that limitation.

Policy tests: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-atlas-recovery.ps1`.
These tests do not send household commands. Integration tests must target verified
Atlas process identities, one component at a time, with health verification afterward.

## Validation limits

Policy tests: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-atlas-recovery.ps1`.
These tests do not send household commands. Integration tests must target verified
Atlas process identities, one component at a time, with health verification afterward.

Successful process-crash recovery tests do not by themselves establish boot-independent
operation, sign-out resilience, or automatic hung-process termination. Prefer pause/resume
maintenance markers over `Stop-ScheduledTask` for ordinary maintenance.

## Rollback and future work

Pause first and verify acknowledgement. To remove supervision, disable the recovery
task, then stop it during a maintenance window, aware that descendants may stop too.
Remove the pause marker only when ready to start Atlas manually again. The original
startup task remains registered and no public GitHub repository is changed by local
recovery tooling alone.

Boot-independent operation still requires an administrator-assisted service migration
and a deliberate service-account/credential design. Do not run the current scripts
as SYSTEM and assume the signed-in user's vault will be available.
