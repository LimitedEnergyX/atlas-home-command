from __future__ import annotations

import csv
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from ..redaction import Redactor
from ..schemas import utc_now


HttpProbe = Callable[[dict[str, Any], float], dict[str, Any]]
CommandRunner = Callable[[list[str], float], subprocess.CompletedProcess[str]]

CONTROL_LINE = re.compile(
    r"^(?P<observed>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z) "
    r"(?P<topic>[^/]+)/(?P<item>\S+) -> (?P<state>resolved|monitoring|open)"
    r"(?: \((?P<detail>.*)\))?$"
)


class JarvisStatusTarget:
    name = "atlas-status"
    writable = False

    def __init__(
        self,
        config_path: Path | None,
        http_probe: HttpProbe | None = None,
        command_runner: CommandRunner | None = None,
        redactor: Redactor | None = None,
    ) -> None:
        self.config_path = Path(config_path) if config_path else None
        self._http_probe = http_probe or self._probe_http
        self._command_runner = command_runner or self._run_command
        self._redactor = redactor or Redactor()

    def status(self) -> dict[str, Any]:
        observed_at = utc_now()
        if not self.config_path or not self.config_path.is_file():
            return {
                "adapter": self.name,
                "host": "ATLAS",
                "status": "unavailable",
                "observed_at": observed_at,
                "reason": "status configuration not found",
            }

        config = self._load_config()
        timeout = float(config.get("probe_timeout_seconds", 2.0))
        with ThreadPoolExecutor(max_workers=3, thread_name_prefix="atlas-section") as executor:
            services_future = executor.submit(self._probe_services, config.get("services", []), timeout)
            containers_future = executor.submit(self._probe_containers, config.get("containers", []), timeout)
            tasks_future = executor.submit(self._probe_tasks, config.get("tasks", []), timeout)
            services = services_future.result()
            containers = containers_future.result()
            tasks = tasks_future.result()
        controls = self._read_controls(config.get("health_log", {}))
        verdict, failures = self._verdict(services, containers, controls)
        return {
            "adapter": self.name,
            "host": str(config.get("host", "ATLAS")),
            "status": verdict,
            "observed_at": observed_at,
            "summary": {
                "services_healthy": sum(item["status"] == "healthy" for item in services),
                "services_total": len(services),
                "containers_running": sum(item["status"] == "running" for item in containers),
                "containers_total": len(containers),
                "tasks_visible": sum(item["status"] != "unknown" for item in tasks),
                "tasks_total": len(tasks),
                "controls_resolved": sum(item["state"] == "resolved" for item in controls["items"]),
                "controls_total": len(controls["items"]),
            },
            "failures": failures,
            "scores": self._health_scores(controls["items"]),
            "services": services,
            "containers": containers,
            "tasks": tasks,
            "health_controls": controls,
        }

    def _load_config(self) -> dict[str, Any]:
        assert self.config_path is not None
        value = json.loads(self.config_path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("schema_version") != 1:
            raise ValueError("JARVIS status configuration must use schema_version 1")
        for service in value.get("services", []):
            parsed = urllib.parse.urlsplit(str(service.get("url", "")))
            if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
                "127.0.0.1",
                "localhost",
                "::1",
            }:
                raise ValueError(f"service {service.get('id', '<unknown>')} is not loopback-only")
        return value

    def _probe_services(self, definitions: list[dict[str, Any]], timeout: float) -> list[dict[str, Any]]:
        if not definitions:
            return []
        workers = min(16, max(1, len(definitions)))
        results: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="atlas-status") as executor:
            futures = {executor.submit(self._http_probe, item, timeout): item for item in definitions}
            for future in as_completed(futures):
                definition = futures[future]
                try:
                    result = future.result()
                except Exception as exc:
                    result = {
                        "id": str(definition.get("id", "unknown")),
                        "status": "unreachable",
                        "required": bool(definition.get("required", True)),
                        "critical": bool(definition.get("critical", False)),
                        "http_status": None,
                        "latency_ms": None,
                        "error": self._safe_error(exc),
                    }
                results.append(result)
        order = {str(item.get("id")): index for index, item in enumerate(definitions)}
        return sorted(results, key=lambda item: order.get(item["id"], len(order)))

    @staticmethod
    def _probe_http(definition: dict[str, Any], timeout: float) -> dict[str, Any]:
        started = time.monotonic()
        expected = {int(value) for value in definition.get("expected_status", [200])}
        request = urllib.request.Request(
            str(definition["url"]),
            method="GET",
            headers={"User-Agent": "Atlas-Orchestrator-Status/1"},
        )
        status_code: int | None = None
        error: str | None = None
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status_code = int(response.status)
                response.read(1024)
        except urllib.error.HTTPError as exc:
            status_code = int(exc.code)
            error = f"HTTP {exc.code}"
        except (TimeoutError, urllib.error.URLError, OSError) as exc:
            error = JarvisStatusTarget._safe_error(exc)
        latency_ms = round((time.monotonic() - started) * 1000, 2)
        return {
            "id": str(definition["id"]),
            "status": "healthy" if status_code in expected else "unreachable",
            "required": bool(definition.get("required", True)),
            "critical": bool(definition.get("critical", False)),
            "http_status": status_code,
            "latency_ms": latency_ms,
            "error": None if status_code in expected else error or "unexpected HTTP status",
        }

    def _probe_containers(self, definitions: list[dict[str, Any]], timeout: float) -> list[dict[str, Any]]:
        if not definitions:
            return []
        try:
            completed = self._command_runner(
                ["docker", "ps", "--format", "{{.Names}}|{{.Status}}"], timeout
            )
            if completed.returncode != 0:
                raise RuntimeError("docker ps returned a non-zero exit code")
            actual: dict[str, str] = {}
            for line in completed.stdout.splitlines():
                name, separator, status = line.partition("|")
                if separator:
                    actual[name.strip()] = status.strip()
            return [
                {
                    "id": str(item["id"]),
                    "status": "running" if actual.get(str(item["name"]), "").startswith("Up") else "missing",
                    "required": bool(item.get("required", True)),
                    "critical": bool(item.get("critical", False)),
                }
                for item in definitions
            ]
        except Exception as exc:
            return [
                {
                    "id": str(item["id"]),
                    "status": "unknown",
                    "required": bool(item.get("required", True)),
                    "critical": bool(item.get("critical", False)),
                    "error": self._safe_error(exc),
                }
                for item in definitions
            ]

    def _probe_tasks(self, definitions: list[dict[str, Any]], timeout: float) -> list[dict[str, Any]]:
        def probe(item: dict[str, Any]) -> dict[str, Any]:
            try:
                completed = self._command_runner(
                    ["schtasks", "/Query", "/TN", str(item["name"]), "/FO", "CSV", "/NH"], timeout
                )
                if completed.returncode != 0:
                    raise RuntimeError("task is not visible to the current process token")
                rows = list(csv.reader(completed.stdout.splitlines()))
                raw_status = rows[0][2].strip() if rows and len(rows[0]) >= 3 else ""
                normalized = raw_status.lower()
                status = "running" if normalized == "running" else "ready" if normalized == "ready" else "unknown"
                return {"id": str(item["id"]), "status": status, "required": bool(item.get("required", False))}
            except Exception as exc:
                return {
                    "id": str(item["id"]),
                    "status": "unknown",
                    "required": bool(item.get("required", False)),
                    "error": self._safe_error(exc),
                }
        if not definitions:
            return []
        with ThreadPoolExecutor(
            max_workers=min(12, len(definitions)), thread_name_prefix="atlas-task"
        ) as executor:
            return list(executor.map(probe, definitions))

    def _read_controls(self, definition: dict[str, Any]) -> dict[str, Any]:
        path = Path(str(definition.get("path", "")))
        max_age_seconds = float(definition.get("max_age_seconds", 600))
        timestamp_basis = str(definition.get("timestamp_basis", "utc"))
        if timestamp_basis not in {"utc", "local-wall-clock"}:
            raise ValueError("health_log.timestamp_basis must be utc or local-wall-clock")
        latest: dict[tuple[str, str], dict[str, Any]] = {}
        try:
            if not path.is_file():
                return {"status": "missing", "age_seconds": None, "items": []}
            with path.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    match = CONTROL_LINE.match(line.strip())
                    if not match:
                        continue
                    item = {
                        "topic": match.group("topic"),
                        "item": match.group("item"),
                        "state": match.group("state"),
                        "observed_at": match.group("observed"),
                        "detail": self._redactor.redact((match.group("detail") or "")[:300]),
                        "_observed": datetime.strptime(match.group("observed"), "%Y-%m-%d %H:%M:%SZ"),
                    }
                    latest[(item["topic"], item["item"])] = item
        except OSError:
            # Removable, encrypted, or temporarily offline recovery storage must
            # degrade the status snapshot instead of crashing the entire API.
            return {"status": "unavailable", "age_seconds": None, "items": []}
        if not latest:
            return {"status": "missing", "age_seconds": None, "items": []}
        newest = max(item["_observed"] for item in latest.values())
        freshness_cutoff = newest - timedelta(seconds=max_age_seconds)
        current_items = [item for item in latest.values() if item["_observed"] >= freshness_cutoff]
        if timestamp_basis == "utc":
            newest = newest.replace(tzinfo=timezone.utc)
            age = max(0.0, (datetime.now(timezone.utc) - newest).total_seconds())
        else:
            age = max(0.0, (datetime.now() - newest).total_seconds())
        for item in current_items:
            item.pop("_observed", None)
        return {
            "status": "current" if age <= max_age_seconds else "stale",
            "age_seconds": round(age, 1),
            "items": sorted(current_items, key=lambda item: (item["topic"], item["item"])),
        }

    @staticmethod
    def _verdict(
        services: list[dict[str, Any]],
        containers: list[dict[str, Any]],
        controls: dict[str, Any],
    ) -> tuple[str, list[dict[str, str]]]:
        failures: list[dict[str, str]] = []
        critical_failure = controls.get("status") != "current"
        if critical_failure:
            failures.append({"source": "health_controls", "id": "health-check", "status": str(controls.get("status"))})
        for item in [*services, *containers]:
            expected = "healthy" if "http_status" in item else "running"
            if item.get("required") and item.get("status") != expected:
                failures.append({"source": "service" if "http_status" in item else "container", "id": item["id"], "status": item["status"]})
                critical_failure = critical_failure or bool(item.get("critical"))
        for item in controls.get("items", []):
            if item["state"] != "resolved":
                failures.append({"source": "health_control", "id": f"{item['topic']}/{item['item']}", "status": item["state"]})
                critical_failure = critical_failure or item["state"] == "open"
        if critical_failure:
            return "unhealthy", failures
        return ("degraded" if failures else "healthy"), failures

    @staticmethod
    def _health_scores(items: list[dict[str, Any]]) -> dict[str, int]:
        values = {"resolved": 100, "monitoring": 50, "open": 0}

        def score(topic: str | None = None) -> int:
            selected = [
                values.get(str(item.get("state")), 0)
                for item in items
                if topic is None or str(item.get("topic")) == topic
            ]
            return round(sum(selected) / len(selected)) if selected else 0

        return {
            "overall": score(),
            "network": score("network"),
            "system": score("system"),
            "monitoring": score("monitoring"),
            "hygiene": score("hygiene"),
        }

    @staticmethod
    def _run_command(args: list[str], timeout: float) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
            shell=False,
        )

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        if isinstance(exc, (TimeoutError, subprocess.TimeoutExpired)):
            return "timeout"
        if isinstance(exc, urllib.error.URLError):
            return "connection failed"
        return type(exc).__name__
