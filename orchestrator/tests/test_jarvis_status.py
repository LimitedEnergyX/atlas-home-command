from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from unittest import mock
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.api import AtlasHTTPServer  # noqa: E402
from atlas_orchestrator.config import Settings  # noqa: E402
from atlas_orchestrator.core import AtlasOrchestrator  # noqa: E402
from atlas_orchestrator.targets import JarvisStatusTarget  # noqa: E402


class JarvisStatusTargetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.health_log = self.root / "health-check.log"
        self.timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
        self.health_log.write_text(
            f"{self.timestamp} monitoring/Forwarder_stability -> resolved (points=10)\n"
            f"{self.timestamp} monitoring/HomeAssistant_polling -> resolved (points=20)\n",
            encoding="utf-8",
        )
        self.config_path = self.root / "jarvis-status.json"
        self.config = {
            "schema_version": 1,
            "host": "JARVIS-TEST",
            "probe_timeout_seconds": 0.05,
            "services": [
                {
                    "id": "homeassistant",
                    "url": "http://127.0.0.1:8123/",
                    "expected_status": [200],
                    "required": True,
                    "critical": True,
                },
                {
                    "id": "optional",
                    "url": "http://localhost:9999/",
                    "expected_status": [200],
                    "required": False,
                },
            ],
            "containers": [
                {"id": "homeassistant", "name": "homeassistant", "required": True, "critical": True}
            ],
            "tasks": [{"id": "forwarder", "name": "Jarvis_SysmonForwarder"}],
            "health_log": {"path": str(self.health_log), "max_age_seconds": 600},
        }
        self._write_config()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_config(self) -> None:
        self.config_path.write_text(json.dumps(self.config), encoding="utf-8")

    @staticmethod
    def healthy_http(definition, timeout):
        return {
            "id": definition["id"],
            "status": "healthy",
            "required": bool(definition.get("required", True)),
            "critical": bool(definition.get("critical", False)),
            "http_status": 200,
            "latency_ms": 1.0,
            "error": None,
        }

    @staticmethod
    def healthy_commands(args, timeout):
        if args[0] == "docker":
            return subprocess.CompletedProcess(args, 0, "homeassistant|Up 10 minutes\n", "")
        return subprocess.CompletedProcess(args, 0, '"\\Jarvis_SysmonForwarder","N/A","Running"\n', "")

    def target(self, http_probe=None, command_runner=None):
        return JarvisStatusTarget(
            self.config_path,
            http_probe=http_probe or self.healthy_http,
            command_runner=command_runner or self.healthy_commands,
        )

    def test_healthy_snapshot_is_normalized_and_read_only(self):
        before = {
            path: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (self.config_path, self.health_log)
        }
        result = self.target().status()
        after = {
            path: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (self.config_path, self.health_log)
        }
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["summary"]["services_healthy"], 2)
        self.assertEqual(result["containers"][0]["status"], "running")
        self.assertEqual(result["tasks"][0]["status"], "running")
        self.assertEqual(before, after)
        serialized = json.dumps(result)
        self.assertNotIn("http://", serialized)
        self.assertNotIn("CommandLine", serialized)

    def test_optional_service_failure_does_not_degrade(self):
        def probe(definition, timeout):
            result = self.healthy_http(definition, timeout)
            if definition["id"] == "optional":
                result.update(status="unreachable", http_status=None, error="connection failed")
            return result

        result = self.target(http_probe=probe).status()
        self.assertEqual(result["status"], "healthy")

    def test_critical_service_failure_is_unhealthy(self):
        def probe(definition, timeout):
            result = self.healthy_http(definition, timeout)
            if definition["id"] == "homeassistant":
                result.update(status="unreachable", http_status=None, error="connection failed")
            return result

        result = self.target(http_probe=probe).status()
        self.assertEqual(result["status"], "unhealthy")
        self.assertIn("homeassistant", [item["id"] for item in result["failures"]])

    def test_timeout_is_bounded_and_sanitized(self):
        def timeout_probe(definition, timeout):
            raise TimeoutError("secret internal detail")

        started = time.monotonic()
        result = self.target(http_probe=timeout_probe).status()
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(result["status"], "unhealthy")
        serialized = json.dumps(result)
        self.assertIn("timeout", serialized)
        self.assertNotIn("secret internal detail", serialized)

    def test_monitoring_control_degrades_and_open_control_is_unhealthy(self):
        self.health_log.write_text(
            f"{self.timestamp} monitoring/Forwarder_stability -> monitoring (points=0)\n",
            encoding="utf-8",
        )
        self.assertEqual(self.target().status()["status"], "degraded")
        self.health_log.write_text(
            f"{self.timestamp} monitoring/Forwarder_stability -> open (points=0)\n",
            encoding="utf-8",
        )
        self.assertEqual(self.target().status()["status"], "unhealthy")

    def test_old_control_timestamp_is_stale_even_when_file_is_new(self):
        self.health_log.write_text(
            "2000-01-01 00:00:00Z monitoring/Forwarder_stability -> resolved (points=10)\n",
            encoding="utf-8",
        )
        result = self.target().status()
        self.assertEqual(result["health_controls"]["status"], "stale")
        self.assertEqual(result["status"], "unhealthy")

    def test_live_health_window_covers_twenty_minute_schedule_but_expires(self):
        live_config = json.loads((ROOT / "config" / "atlas-status.json").read_text())
        max_age = live_config["health_log"]["max_age_seconds"]
        self.assertEqual(max_age, 1800)  # 20-minute interval plus ten-minute grace.
        self.config["health_log"]["max_age_seconds"] = max_age
        self._write_config()
        for age, expected in [(1200, "current"), (1860, "stale")]:
            stamp = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() - age, timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
            self.health_log.write_text(f"{stamp} monitoring/Atlas_live -> resolved (HTTP probe passed)\n", encoding="utf-8")
            with self.subTest(age=age):
                self.assertEqual(self.target().status()["health_controls"]["status"], expected)

    def test_unavailable_health_log_storage_degrades_without_crashing(self):
        with mock.patch.object(Path, "is_file", side_effect=OSError("encrypted drive unavailable")):
            controls = self.target()._read_controls(self.config["health_log"])
        self.assertEqual(controls["status"], "unavailable")
        self.assertEqual(controls["items"], [])

    def test_partial_new_cycle_keeps_fresh_controls_from_previous_cycle(self):
        previous = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() - 240,
            timezone.utc,
        ).strftime("%Y-%m-%d %H:%M:%SZ")
        self.health_log.write_text(
            f"{previous} monitoring/Forwarder_stability -> resolved (points=10)\n"
            f"{previous} hygiene/Bolt_backup -> monitoring (backup_age_h=27)\n"
            f"{self.timestamp} network/LLMNR_disabled -> resolved (EnableMulticast=0)\n",
            encoding="utf-8",
        )
        result = self.target().status()
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["scores"]["monitoring"], 100)
        self.assertEqual(result["scores"]["hygiene"], 50)
        self.assertEqual(result["scores"]["network"], 100)

    def test_explicit_local_wall_clock_source_is_current(self):
        local_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%SZ")
        self.health_log.write_text(
            f"{local_timestamp} monitoring/Forwarder_stability -> resolved (points=10)\n",
            encoding="utf-8",
        )
        self.config["health_log"]["timestamp_basis"] = "local-wall-clock"
        self._write_config()
        self.assertEqual(self.target().status()["health_controls"]["status"], "current")

    def test_external_service_url_is_rejected_before_probe(self):
        self.config["services"][0]["url"] = "https://example.com/health"
        self._write_config()
        with self.assertRaisesRegex(ValueError, "loopback-only"):
            self.target().status()

    def test_task_visibility_failure_is_advisory(self):
        def runner(args, timeout):
            if args[0] == "docker":
                return self.healthy_commands(args, timeout)
            return subprocess.CompletedProcess(args, 1, "", "Access denied")

        result = self.target(command_runner=runner).status()
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["tasks"][0]["status"], "unknown")
        self.assertNotIn("Access denied", json.dumps(result))

    def test_health_detail_redacts_bearer_credentials(self):
        self.health_log.write_text(
            f"{self.timestamp} monitoring/Test -> resolved (Authorization=Bearer abc.def.ghi)\n",
            encoding="utf-8",
        )
        serialized = json.dumps(self.target().status())
        self.assertNotIn("abc.def.ghi", serialized)
        self.assertIn("[REDACTED]", serialized)


class JarvisStatusAPITests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        core = AtlasOrchestrator(Settings(Path(self.temporary.name), retry_budget=0))

        class FixedTarget:
            def status(self):
                return {"adapter": "atlas-status", "host": "Atlas Server", "status": "healthy"}

        core.targets["jarvis-status"] = FixedTarget()
        self.core = core
        self.server = AtlasHTTPServer(("127.0.0.1", 0), core)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def test_atlas_route_returns_snapshot_and_records_observation(self):
        url = f"http://127.0.0.1:{self.server.server_port}/v1/atlas/status"
        with urllib.request.urlopen(url, timeout=2) as response:
            result = json.loads(response.read())
        self.assertEqual(result["status"], "healthy")
        event = self.core.ledger.latest_payload("atlas", "status_observation")
        self.assertEqual(event["status"], "healthy")

    def test_jarvis_route_remains_a_compatibility_alias(self):
        url = f"http://127.0.0.1:{self.server.server_port}/v1/jarvis/status"
        with urllib.request.urlopen(url, timeout=2) as response:
            result = json.loads(response.read())
        self.assertEqual(result["status"], "healthy")
        event = self.core.ledger.latest_payload("atlas", "status_observation")
        self.assertEqual(event["status"], "healthy")


if __name__ == "__main__":
    unittest.main()
