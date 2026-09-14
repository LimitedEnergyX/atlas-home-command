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

Validation on September 8, 2026:

- 14 recovery-decision tests and two harmless child exit-code tests passed.
- Maintenance pause was acknowledged and prevented Energy from restarting after a
  controlled process stop. Explicit resume restored the adapter and live Tesla polling.
- A controlled Atlas Home listener stop was recovered automatically; HVAC telemetry returned.
- The final Energy crash test recovered to polling-ready in 24.2 seconds, with zero
  polling errors. Corrected launch-result logging was verified in this test.
- Both services were healthy after reloading the supervisor; all 116 displayed home
  entities were available. No household control commands were sent.
- No reboot, sign-out, live three-crash circuit-breaker test, or hung-process kill test
  was performed. Circuit-breaker decisions were policy-tested; hung processes are
  deliberately not killed automatically.

## Rollback and future work

### Post-reboot readiness correction, September 8, 2026

The 15:50 Windows boot completed and the startup task launched Home and Energy.
Its final one-shot probe reported Open WebUI unavailable at 15:54:38. Subsequent
health checks passed, but the historical task exit code kept the startup control
open. No current service outage was observed during the investigation.

- `Atlas.StartupHealth.psm1` now provides a 120-second readiness retry budget for
  startup HTTP endpoints. Startup step failures still produce a failed result.
- The health checker now probes Grafana, SearxNG, and ntfy in addition to the
  previous endpoints. A failed startup result is retained as `monitoring`, rather
  than a current outage, only when the task ran this boot and every current HTTP
  probe and expected-container presence check passes. Missing, disabled, or
  not-run-this-boot tasks remain open. Live endpoint failures remain separate open
  controls, even when the historical startup exit code was zero.
- No historical Task Scheduler result was rewritten. The startup task was not
  rerun, and no application or container was restarted to perform this change.
- 14 startup-health tests, 14 existing recovery-policy tests, two harmless
  child-process tests, and syntax parsing passed. Live readiness probes passed.
  The actual scheduled health check completed with result 0 at 18:07:52 CDT;
  all nine HTTP probes passed, all six containers were present, and runtime
  recovery remained healthy. A full cold-boot test of the new wait is still pending.
- Pre-change copies of the two scripts and this document are preserved at
  `C:\ProgramData\Atlas\Backups\startup-health-20260908`.

### Hardware diagnostic findings, same day

Read-only elevated checks found D: (disk 0) and E: (disk 1) locked by BitLocker,
with automatic unlock disabled. This explains the unrecognized filesystem
presentation; it does not verify filesystem integrity. No unlocking, formatting,
initializing, repair, or encryption-setting changes were performed. C: is fully
decrypted with BitLocker protection off. Disk 1 / E: reports 9 uncorrected read
errors in device counters; age and trend are unknown. Prioritize preservation
before repair or a surface scan.

The Intel TPM 2.0 reports ready, enabled, activated, and not locked out;
`tpmtool` reports no clear needed. `Get-Tpm` reports RestartPending, and pending
file-renames exist, while Windows Update/CBS reboot markers were absent. The
earlier certificate-enrollment failures were not resolved by these diagnostics.
No TPM clear, BIOS/security change, or reboot was performed. Detailed local report:
`C:\Users\example\Downloads\Atlas-storage-TPM-check-20260908.txt`.

Pause first and verify acknowledgement. To remove supervision, disable the recovery
task, then stop it during a maintenance window, aware that descendants may stop too.
Remove the pause marker only when ready to start Atlas manually again. The original
startup task remains registered and no public GitHub repository is changed.

Boot-independent operation still requires an administrator-assisted service migration
and a deliberate service-account/credential design. Do not run the current scripts
as SYSTEM and assume the signed-in user's vault will be available. Sign-out, reboot,
and hang recovery are not established by a successful process-crash recovery test.
