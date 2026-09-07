"""Local, bounded host telemetry. No LLM, raw commands, remote writes or auto-remediation."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

RULE_VERSION = "2026-09-06.1"
CHANNELS = ("Defender", "Security", "Sysmon")


def utcnow():
    return datetime.now(timezone.utc)


def parse_time(value):
    if not isinstance(value, str):
        raise ValueError("timestamp must be text")
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def event_rule(event):
    channel, code = event.get("channel"), event.get("event_id")
    rules = {
        ("Defender", 1116): ("defender-detection", "high", "Defender Detected A Threat"),
        ("Security", 1102): ("audit-cleared", "high", "Security Audit Log Cleared"),
        ("Security", 4720): ("account-created", "review", "Local Account Created"),
        ("Security", 4728): ("group-member", "review", "Security Group Membership Changed"),
        ("Security", 4732): ("group-member", "review", "Local Group Membership Changed"),
        ("Sysmon", 25): ("process-tamper", "high", "Process Tampering Reported"),
        ("Sysmon", 255): ("sysmon-error", "review", "Sysmon Collection Error"),
        ("Sysmon", 16): ("sysmon-config", "review", "Sysmon Rules Changed"),
    }
    if (channel, code) in rules:
        return rules[channel, code]
    if channel == "Sysmon" and code in (19, 20, 21):
        return "wmi-persistence", "review", "WMI Persistence Change"
    if channel == "Sysmon" and code == 1:
        if event.get("office_child"):
            return "office-shell", "high", "Office Started A Command Interpreter"
        if event.get("encoded"):
            return "encoded-shell", "review", "Encoded PowerShell Command"
    if channel == "Sysmon" and code == 10 and event.get("lsass_write"):
        return "lsass-access", "high", "Broad Access To Credential Process"
    if channel == "Sysmon" and code == 8 and str(event.get("target", "")).lower() == "lsass.exe":
        return "lsass-thread", "high", "Remote Thread In Credential Process"
    return None


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS events (key TEXT PRIMARY KEY, observed TEXT NOT NULL, rule TEXT, severity TEXT, title TEXT, subject TEXT, peer TEXT)")
    db.execute("CREATE INDEX IF NOT EXISTS events_observed ON events(observed)")
    return db


def ingest(db, payload, now=None):
    now = now or utcnow()
    added = 0
    for event in payload.get("events", [])[:3000]:
        if event.get("channel") not in CHANNELS:
            continue
        try:
            stamp = parse_time(event["time"])
            record = int(event["record_id"])
        except (KeyError, ValueError, TypeError):
            continue
        if stamp > now + timedelta(minutes=2) or stamp < now - timedelta(days=7):
            continue
        key = f"{event['channel']}:{record}:{stamp.isoformat()}"
        rule = event_rule(event)
        # Quiet events count only toward deduplication and failed-login thresholds.
        rule_id, severity, title = rule or (None, None, None)
        if event.get("channel") == "Security" and event.get("event_id") == 4625:
            rule_id = "failed-login"
        subject = str(event.get("source") or event.get("image") or event.get("channel"))[:80]
        # Basenames only: never retain an arbitrary path or caller-supplied command line.
        subject = subject.replace("\\", "/").rsplit("/", 1)[-1]
        peer = str(event.get("peer_hash", ""))[:16]
        added += db.execute("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?)", (key, stamp.isoformat(), rule_id, severity, title, subject, peer)).rowcount
    db.execute("DELETE FROM events WHERE observed < ?", ((now-timedelta(days=7)).isoformat(),))
    db.execute("DELETE FROM events WHERE key IN (SELECT key FROM events ORDER BY observed DESC LIMIT -1 OFFSET 20000)")
    db.commit()
    return added


def summarize(db, payload, now=None):
    now = now or utcnow()
    posture = payload.get("posture", {})
    checks = []
    defender = posture.get("defender", {})
    firewall = posture.get("firewall", {})
    def check(key, label, passed, known=True):
        checks.append({"id": key, "label": label, "status": "unknown" if not known else "pass" if passed else "attention"})
    check("realtime", "Real-Time Protection", defender.get("antivirus") and defender.get("realtime"), defender.get("available", False))
    check("tamper", "Tamper Protection", defender.get("tamper"), defender.get("available", False))
    age = defender.get("signature_age")
    check("signatures", "Protection Updates", isinstance(age, int) and 0 <= age <= 2, defender.get("available", False) and age is not None)
    check("firewall", "Windows Firewall", firewall.get("enabled"), firewall.get("available", False))
    channels = []
    observed = {row.get("name"): row for row in payload.get("channels", [])}
    for name in CHANNELS:
        row = observed.get(name, {})
        channels.append({"name":name, "status":row.get("status", "unknown"), "capped":bool(row.get("capped")), "events":int(row.get("count", 0))})
    findings = []
    cutoff = (now-timedelta(hours=24)).isoformat()
    for rule, severity, title, subject, count, first, last in db.execute("SELECT rule,severity,title,subject,COUNT(*),MIN(observed),MAX(observed) FROM events WHERE observed>=? AND severity IS NOT NULL GROUP BY rule,severity,title,subject ORDER BY MAX(observed) DESC LIMIT 40", (cutoff,)):
        findings.append({"id":hashlib.sha256(f"{rule}:{subject}".encode()).hexdigest()[:16], "rule":rule, "severity":severity, "title":title, "subject":subject, "count":count, "first_seen":first, "last_seen":last, "note":"Observed event; review context. This is not a confirmed compromise."})
    login_cutoff = (now-timedelta(minutes=10)).isoformat()
    for peer, count in db.execute("SELECT peer,COUNT(*) FROM events WHERE rule='failed-login' AND observed>=? AND peer!='' GROUP BY peer HAVING COUNT(*)>=10", (login_cutoff,)):
        findings.append({"id":f"login-{peer}", "rule":"login-burst", "severity":"review", "title":"Repeated Failed Sign-Ins", "subject":"Same Source · 10 Minutes", "count":count, "last_seen":now.isoformat(), "note":"May be stale saved credentials; investigate before blocking anything."})
    gaps = any(c["status"] != "current" or c["capped"] for c in channels)
    attention = sum(c["status"] == "attention" for c in checks)
    unknown = sum(c["status"] == "unknown" for c in checks)
    high = sum(f["severity"] == "high" for f in findings)
    return {"schema_version":1, "observed_at":payload["observed_at"], "rule_version":RULE_VERSION,
            "status":"attention" if attention or high else "partial" if gaps or unknown else "current",
            "checks":checks, "channels":channels, "findings":findings,
            "summary":{"passed":sum(c["status"] == "pass" for c in checks), "total":len(checks), "attention":attention, "unknown":unknown, "high":high, "review":sum(f["severity"] == "review" for f in findings)},
            "scope":"Atlas PC Only · Network Deferred", "retention":"7 Days / 20,000 Events", "poll_seconds":300}


def read_snapshot(path, now=None):
    now = now or utcnow()
    try:
        if path.stat().st_size > 2_000_000:
            raise ValueError("oversized")
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("summary"), dict):
            raise ValueError("invalid snapshot")
        for key in ("checks", "channels", "findings"):
            if not isinstance(payload.get(key), list) or not all(isinstance(row, dict) for row in payload[key]):
                raise ValueError("invalid snapshot rows")
        age = (now-parse_time(payload["observed_at"])).total_seconds()
        if payload.get("schema_version") != 1 or age < -120:
            raise ValueError("invalid")
        payload["age_seconds"] = round(age)
        payload["fresh"] = age <= 600
        if not payload["fresh"]:
            payload["status"] = "stale"
        return payload
    except (OSError, ValueError, KeyError, TypeError):
        return {"status":"unavailable", "fresh":False, "summary":{}, "checks":[], "channels":[], "findings":[], "scope":"Atlas PC Only · Network Deferred"}


def collect(data_dir, script):
    data_dir.mkdir(parents=True, exist_ok=True)
    snapshot = data_dir / "cyber-health.json"
    previous = read_snapshot(snapshot)
    now = utcnow()
    last = parse_time(previous["observed_at"]) if previous.get("observed_at") else now-timedelta(hours=1)
    since = max(last-timedelta(minutes=2), now-timedelta(days=1))
    started = time.monotonic()
    inbox_setting = os.environ.get("ATLAS_CYBER_INBOX")
    if not inbox_setting:
        raise RuntimeError("Configure ATLAS_CYBER_INBOX before collecting local cyber evidence")
    inbox = Path(inbox_setting)
    if inbox.exists():
        # Protected OS reader writes here after administrator activation. Do not mask
        # a dead privileged reader by silently falling back to partial user collection.
        if inbox.stat().st_size > 5_000_000:
            raise ValueError("collector inbox oversized")
        payload = json.loads(inbox.read_text(encoding="utf-8-sig"))
        captured = parse_time(payload["observed_at"])
        if (now-captured).total_seconds() > 600 or captured > now+timedelta(minutes=2):
            raise RuntimeError("protected collector stale")
    else:
        result = subprocess.run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), "-Since", since.isoformat()], capture_output=True, text=True, encoding="utf-8-sig", errors="replace", timeout=90, creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        if result.returncode:
            raise RuntimeError("Windows collector failed; previous snapshot retained and will expire")
        payload = json.loads(result.stdout)
    if payload.get("schema_version") != 1:
        raise ValueError("collector schema mismatch")
    with connect(data_dir / "cyber-events.sqlite3") as db:
        added = ingest(db, payload)
        view = summarize(db, payload)
    view["collection"] = {"new_events":added, "duration_seconds":round(time.monotonic()-started, 2), "replay_limited":last < now-timedelta(minutes=15) if inbox.exists() else last < now-timedelta(days=1), "mode":"protected-reader" if inbox.exists() else "current-user"}
    gaps = list(previous.get("coverage_gaps", []))
    for channel in view["channels"]:
        if channel["capped"]:
            gaps.append({"channel":channel["name"], "at":now.isoformat(), "reason":"Event Limit Reached"})
    if view["collection"]["replay_limited"]:
        gaps.append({"channel":"Collector", "at":now.isoformat(), "reason":"Offline Longer Than Replay Window"})
    view["coverage_gaps"] = [gap for gap in gaps if parse_time(gap["at"]) >= now-timedelta(days=7)][-100:]
    if view["coverage_gaps"] and view["status"] == "current":
        view["status"] = "partial"
    temporary = snapshot.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(view, indent=2), encoding="utf-8")
    os.replace(temporary, snapshot)
    return view


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--script", type=Path, required=True)
    args = parser.parse_args()
    collect(args.data_dir, args.script)


if __name__ == "__main__":
    main()
