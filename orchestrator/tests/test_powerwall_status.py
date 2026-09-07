from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.targets.powerwall_status import PowerwallStatusTarget  # noqa: E402


class PowerwallStatusTests(unittest.TestCase):
    def test_normalizes_live_energy_without_exposing_raw_payload(self):
        target = PowerwallStatusTarget(
            "http://127.0.0.1:3002/api/powerwall",
            reader=lambda _url, _timeout: {
                "battery": 88.4,
                "reserve": 20,
                "solar": 6.71,
                "home": 2.99,
                "grid": -3.73,
                "grid_up": True,
                "charging": False,
                "mode": "self_consumption",
                "polled_at": "2026-08-19T19:08:05Z",
                "raw": {"private": "not returned"},
                "financials": {"today": {"solar_kwh": 26.799, "home_kwh": 12.346}},
            },
        )
        result = target.status()
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["grid_direction"], "exporting")
        self.assertEqual(result["battery_pct"], 88.4)
        self.assertEqual(result["today"]["solar_kwh"], 26.799)
        self.assertNotIn("raw", result)

    def test_includes_safe_monthly_financials_and_alerts(self):
        target = PowerwallStatusTarget(
            "http://127.0.0.1:3002/api/powerwall",
            reader=lambda _url, _timeout: {
                "grid": 0,
                "financials": {"monthly": {"est_bill": 51.26, "mtd_import_kwh": 343.3}},
                "weather_alerts": [{"event": "Heat Advisory", "severity": "Moderate", "headline": "Hot", "private": "hidden"}],
            },
        )
        result = target.status()
        self.assertEqual(result["monthly"]["estimated_bill"], 51.26)
        self.assertEqual(result["weather_alerts"][0]["event"], "Heat Advisory")
        self.assertNotIn("private", result["weather_alerts"][0])

    def test_rejects_non_loopback_endpoint(self):
        with self.assertRaises(ValueError):
            PowerwallStatusTarget("https://example.com/api/powerwall")

    def test_failure_is_fail_soft(self):
        def fail(_url: str, _timeout: float) -> dict:
            raise TimeoutError

        result = PowerwallStatusTarget(
            "http://127.0.0.1:3002/api/powerwall", reader=fail
        ).status()
        self.assertEqual(result["status"], "unavailable")

    def test_history_failure_is_fail_soft_and_range_is_bounded(self):
        target = PowerwallStatusTarget(
            "http://127.0.0.1:3002/api/status",
            reader=lambda _endpoint, _timeout: (_ for _ in ()).throw(OSError("offline")),
        )
        result = target.history("day")
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "OSError")
        with self.assertRaises(ValueError):
            target.history("year")

    def test_forecast_includes_hourly_weather_without_raw_fields(self):
        target = PowerwallStatusTarget(
            "http://127.0.0.1:3002/api/powerwall",
            reader=lambda _url, _timeout: {
                "location": "Example Region, TX",
                "current": {"temp_f": 83, "wind_gust_mph": 19, "visibility_mi": 9.7},
                "hourly": [
                    {
                        "time": "2026-09-04T14:00",
                        "temp_f": 84,
                        "precip_prob": 35,
                        "precip_in": 0.02,
                        "uv_index": 6.4,
                        "private": "hidden",
                    }
                ],
                "daily": [{"date": "2026-09-04", "temp_max": 91, "uv_max": 7.1}],
            },
        )
        result = target.forecast()
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["location"], "Example Region, TX")
        self.assertEqual(result["hourly"][0]["precip_prob"], 35)
        self.assertEqual(result["daily"][0]["uv_max"], 7.1)
        self.assertNotIn("private", result["hourly"][0])


if __name__ == "__main__":
    unittest.main()
