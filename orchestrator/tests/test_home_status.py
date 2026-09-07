from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.targets.home_status import HomeStatusTarget  # noqa: E402


class HomeStatusTests(unittest.TestCase):
    def test_normalizes_household_controls_without_exposing_raw_data(self):
        target = HomeStatusTarget(
            "http://127.0.0.1:8123",
            "test-token",
            reader=lambda _url, _token, _timeout: {
                "climate": {
                    "state": "cool",
                    "current_temperature": 74.2,
                    "target_temperature": 72,
                    "hvac_action": "cooling",
                    "unit": "°F",
                    "private": "not returned",
                },
                "environment": [
                    {
                        "id": "east-hallway-temperature",
                        "label": "Main Hall",
                        "group": "temperatures",
                        "kind": "temperature",
                        "state": "22.7",
                        "unit": "°C",
                        "private": "not returned",
                    },
                    {
                        "id": "office-humidity",
                        "label": "Office",
                        "group": "humidity",
                        "kind": "humidity",
                        "state": "42.5",
                        "unit": "%",
                    },
                ],
            },
        )
        result = target.status()
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["climate"]["current_temperature"], 74.2)
        self.assertNotIn("cameras", result)
        self.assertEqual(result["environment"]["temperatures"][0]["value"], 72.9)
        self.assertEqual(result["environment"]["temperatures"][0]["unit"], "°F")
        self.assertEqual(result["environment"]["humidity"][0]["value"], 42.5)
        self.assertNotIn("private", result["climate"])
        self.assertNotIn("private", result["environment"]["temperatures"][0])

    def test_missing_token_is_fail_soft(self):
        result = HomeStatusTarget("http://127.0.0.1:8123", "").status()
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "not_configured")

    def test_rejects_non_loopback_endpoint(self):
        with self.assertRaises(ValueError):
            HomeStatusTarget("https://example.com", "token")

    def test_reader_failure_is_fail_soft(self):
        def fail(_url: str, _token: str, _timeout: float) -> dict:
            raise TimeoutError

        result = HomeStatusTarget(
            "http://127.0.0.1:8123", "token", reader=fail
        ).status()
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "TimeoutError")

    def test_unavailable_measurements_do_not_hide_valid_home_status(self):
        target = HomeStatusTarget(
            "http://127.0.0.1:8123",
            "test-token",
            reader=lambda _url, _token, _timeout: {
                "climate": {
                    "current_temperature": "unavailable",
                    "target_temperature": "unknown",
                },
                "environment": [
                    {
                        "id": "offline-sensor",
                        "label": "Offline Sensor",
                        "group": "temperatures",
                        "kind": "temperature",
                        "state": "unavailable",
                        "unit": "°F",
                    },
                    {
                        "id": "valid-sensor",
                        "label": "Valid Sensor",
                        "group": "temperatures",
                        "kind": "temperature",
                        "state": "72.6",
                        "unit": "°F",
                    },
                ],
            },
        )

        result = target.status()

        self.assertEqual(result["status"], "healthy")
        self.assertIsNone(result["climate"]["current_temperature"])
        self.assertIsNone(result["climate"]["target_temperature"])
        self.assertEqual(result["environment"]["temperatures"][0]["value"], 72.6)

    def test_temperature_write_is_allowlisted_and_bounded(self):
        writes = []
        target = HomeStatusTarget(
            "http://127.0.0.1:8123",
            "test-token",
            reader=lambda _url, _token, _timeout: {
                "climate": {"target_temperature": 72.5},
            },
            writer=lambda endpoint, token, temperature, timeout: writes.append(
                (endpoint, token, temperature, timeout)
            ),
        )
        result = target.set_temperature(72.5)
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["target_temperature"], 72.5)
        self.assertEqual(writes[0][2], 72.5)
        for invalid in (True, "warm", 59.5, 85.5, 72.25):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                target.set_temperature(invalid)


    def test_environment_history_is_fixed_allowlisted_and_normalized(self):
        calls = []
        target = HomeStatusTarget(
            "http://127.0.0.1:8123",
            "test-token",
            history_reader=lambda endpoint, token, timeout, hours: (
                calls.append((endpoint, token, timeout, hours))
                or [
                    {
                        "id": "east-hallway-temperature",
                        "label": "Main Hall",
                        "group": "temperatures",
                        "kind": "temperature",
                        "unit": "°C",
                        "points": [
                            {"at": "2026-08-19T10:00:00+00:00", "value": "22.0"},
                            {"at": "2026-08-19T11:00:00+00:00", "value": "unavailable"},
                            {"at": "2026-08-19T12:00:00+00:00", "value": "23.0"},
                        ],
                    }
                ]
            ),
        )
        result = target.environment_history()
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["hours"], 24)
        self.assertEqual(calls[0][3], 24)
        self.assertEqual(result["series"][0]["unit"], "°F")
        self.assertEqual([point["value"] for point in result["series"][0]["points"]], [71.6, 73.4])
        with self.assertRaises(ValueError):
            target.environment_history(12)


if __name__ == "__main__":
    unittest.main()
