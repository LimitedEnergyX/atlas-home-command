from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any, Callable


PowerwallReader = Callable[[str, float], dict[str, Any]]


class PowerwallStatusTarget:
    name = "powerwall-status"
    writable = False

    def __init__(
        self,
        endpoint: str,
        timeout: float = 2.0,
        reader: PowerwallReader | None = None,
    ) -> None:
        parsed = urllib.parse.urlsplit(endpoint)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Powerwall status endpoint must be loopback HTTP")
        self.endpoint = endpoint
        self.timeout = timeout
        self._reader = reader or self._read

    def status(self) -> dict[str, Any]:
        try:
            source = self._reader(self.endpoint, self.timeout)
            financials = source.get("financials") or {}
            today = financials.get("today", {})
            grid_kw = self._number(source.get("grid"))
            monthly = financials.get("monthly", {})
            cycle = self._billing_cycle(source.get("polled_at"), monthly)
            return {
                "adapter": self.name,
                "status": "healthy",
                "polled_at": source.get("polled_at"),
                "tesla_vehicles": self._vehicle_summary(source.get("tesla_vehicles")),
                "vehicle_charge_snapshot": self._charge_snapshot(source.get("vehicle_charge_snapshot")),
                "battery_pct": self._number(source.get("battery")),
                "reserve_pct": self._number(source.get("reserve")),
                "solar_kw": self._number(source.get("solar")),
                "home_kw": self._number(source.get("home")),
                "grid_kw": grid_kw,
                "grid_direction": (
                    "unknown" if grid_kw is None else "exporting" if grid_kw < 0 else "importing"
                ),
                "grid_up": bool(source.get("grid_up")),
                "charging": bool(source.get("charging")),
                "mode": source.get("mode"),
                "today": {
                    "solar_kwh": self._number(today.get("solar_kwh")),
                    "home_kwh": self._number(today.get("home_kwh")),
                    "import_kwh": self._number(today.get("import_kwh")),
                    "export_kwh": self._number(today.get("export_kwh")),
                    "solar_savings": self._number(today.get("solar_savings")),
                },
                "monthly": {
                    "import_kwh": self._number(monthly.get("mtd_import_kwh")),
                    "export_kwh": self._number(monthly.get("mtd_export_kwh")),
                    "energy_charge": self._number(monthly.get("mtd_energy_charge")),
                    "export_credit": self._number(monthly.get("mtd_export_credit")),
                    "estimated_bill": self._number(monthly.get("est_bill")),
                    "bank_balance": self._number(monthly.get("bank_balance")),
                    "projected_import_kwh": self._number(monthly.get("mo_import_kwh")),
                    "projected_export_kwh": self._number(monthly.get("mo_export_kwh")),
                    **cycle,
                },
                "rates": {
                    key: self._number(value)
                    for key, value in financials.get("rates", {}).items()
                    if key in {"energy", "buyback", "base", "tdu_fixed", "tdu_kwh", "grr", "tax_rate"}
                },
                "weather_alerts": [
                    {
                        "event": str(item.get("event") or "Weather alert"),
                        "severity": item.get("severity"),
                        "headline": item.get("headline"),
                        "expires": item.get("expires"),
                    }
                    for item in source.get("weather_alerts", [])[:8]
                    if isinstance(item, dict)
                ],
            }
        except Exception as exc:
            return {"adapter": self.name, "status": "unavailable", "reason": type(exc).__name__}

    def forecast(self) -> dict[str, Any]:
        try:
            endpoint = self.endpoint.rsplit("/", 1)[0] + "/weather-forecast"
            source = self._reader(endpoint, self.timeout + 3.0)
            current = source.get("current", {})
            hourly = source.get("hourly", [])
            daily = source.get("daily", [])
            return {
                "adapter": self.name,
                "status": "healthy",
                "location": source.get("location"),
                "current": {
                    key: current.get(key)
                    for key in ("temp_f", "feels_like_f", "humidity", "wind_mph", "wind_gust_mph", "wind_dir", "visibility_mi", "precip_in", "cloud_pct", "desc", "icon")
                },
                "hourly": [
                    {
                        key: item.get(key)
                        for key in (
                            "time", "temp_f", "feels_like_f", "humidity", "precip_prob",
                            "precip_in", "wind_mph", "wind_gust_mph", "visibility_mi",
                            "uv_index", "desc", "icon"
                        )
                    }
                    for item in hourly[:48]
                    if isinstance(item, dict) and item.get("time")
                ],
                "daily": [
                    {key: item.get(key) for key in ("date", "temp_max", "temp_min", "precip_in", "precip_prob", "precip_hours", "wind_max", "uv_max", "sunrise", "sunset", "desc", "icon")}
                    for item in daily[:10]
                    if isinstance(item, dict)
                ],
                "observed_at": datetime.now(UTC).isoformat(),
            }
        except Exception as exc:
            return {"adapter": self.name, "status": "unavailable", "reason": type(exc).__name__}

    def calendar_source(self, kind: str, period: str, start: str, end: str) -> dict[str, Any]:
        endpoint = self.endpoint.rsplit("/", 1)[0] + "/calendar-history?" + urllib.parse.urlencode({
            "kind": kind, "period": period, "start_date": start, "end_date": end,
            "time_zone": "America/Chicago",
        })
        return self._reader(endpoint, 30.0)

    def history(self, range_name: str) -> dict[str, Any]:
        if range_name not in {"day", "week", "month"}:
            raise ValueError("range must be day, week, or month")
        try:
            endpoint = self.endpoint.rsplit("/", 1)[0] + "/energy-history?" + urllib.parse.urlencode({"range": range_name})
            source = self._reader(endpoint, self.timeout + 3.0)
            return {
                "adapter": self.name,
                "status": "healthy",
                "range": range_name,
                "window": source.get("window"),
                "points": [
                    {
                        "at": str(point.get("at")),
                        **{
                            field: self._number(point.get(field))
                            for field in ("solar_kw", "home_kw", "grid_kw", "battery_pct")
                            if point.get(field) is not None
                        },
                    }
                    for point in source.get("points", [])
                    if isinstance(point, dict) and point.get("at")
                ],
            }
        except Exception as exc:
            return {"adapter": self.name, "status": "unavailable", "range": range_name, "reason": type(exc).__name__}

    @staticmethod
    def _billing_cycle(polled_at: Any, monthly: dict[str, Any]) -> dict[str, Any]:
        try:
            observed = datetime.fromisoformat(str(polled_at).replace("Z", "+00:00"))
            days_elapsed = float(monthly.get("days_elapsed"))
            cycle_days = int(round(float(monthly.get("cycle_days"))))
            if cycle_days <= 0:
                raise ValueError("invalid cycle")
            start = observed.date() - timedelta(days=max(0, int(days_elapsed)))
            end = start + timedelta(days=cycle_days - 1)
            return {
                "cycle_start": start.isoformat(),
                "cycle_end": end.isoformat(),
                "days_elapsed": round(days_elapsed, 1),
                "days_remaining": max(0, (end - observed.date()).days),
                "cycle_days": cycle_days,
            }
        except (TypeError, ValueError, OverflowError):
            return {}

    @staticmethod
    def _charge_snapshot(source: Any) -> dict[str, Any] | None:
        if not isinstance(source, dict) or source.get("status") not in {"read_success", "basic_status"}:
            return None
        charge = source.get("charge_state")
        if not isinstance(charge, dict):
            return None
        # Vehicle samples stay separate from household power and historical attribution.
        basic = source.get("status") == "basic_status"
        result = {"status": "periodic_sample" if basic else "snapshot_only", "checked_at": source.get("checked_at"),
                  "automatic_collection": basic and source.get("automatic_collection") is True, "commands_enabled": False,
                  "charging_state": str(charge.get("charging_state") or "Unknown")[:80]}
        if basic:
            result.update({"collection_status": str(source.get("collection_status") or "Unknown")[:100],
                           "last_check_at": source.get("last_check_at"),
                           "next_check_at": source.get("next_check_at"), "update_interval_minutes": 30})
        for key in ("battery_level", "charge_limit_soc", "charger_power", "battery_range",
                    "charge_energy_added", "charge_miles_added_rated", "charger_actual_current", "charger_voltage", "timestamp"):
            value = charge.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and float('-inf') < value < float('inf'):
                result[key] = value
        if basic:
            result["observations"] = []
            rows = source.get("observations")
            for row in (rows[-1500:] if isinstance(rows, list) else []):
                if not isinstance(row, dict):
                    continue
                try:
                    observed = datetime.fromisoformat(str(row.get("observed_at")).replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    continue
                item = {"observed_at": observed.isoformat(), "charging_state": str(row.get("charging_state") or "Unknown")[:80]}
                for key in ("battery_level", "charger_power", "charge_energy_added", "charge_miles_added_rated"):
                    value = row.get(key)
                    if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value < float('inf'):
                        item[key] = value
                result["observations"].append(item)
            count = source.get("stored_observation_count")
            result["stored_observation_count"] = count if isinstance(count, int) and not isinstance(count, bool) and count >= 0 else len(result["observations"])
        return result

    @staticmethod
    def _vehicle_summary(source: Any) -> dict[str, Any]:
        if not isinstance(source, dict):
            source = {}
        vehicles = source.get("vehicles")
        if not isinstance(vehicles, list):
            vehicles = []
        return {
            "status": source.get("status", "not_checked"),
            "observed_at": source.get("observed_at"),
            "information_access": source.get("information_access", "unknown"),
            "vehicles": [{"name": str(v.get("name") or "Tesla Vehicle")[:120],
                          "state": v.get("state", "unknown")}
                         for v in vehicles[:100] if isinstance(v, dict)],
            "live_readings": "disabled_metered_endpoint",
            "commands_enabled": False,
        }

    @staticmethod
    def _read(endpoint: str, timeout: float) -> dict[str, Any]:
        request = urllib.request.Request(endpoint, headers={"User-Agent": "Atlas-Energy-Status/1"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(20_000_001)
            if len(raw) > 20_000_000:
                raise ValueError("Powerwall response is too large")
            payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Powerwall response must be an object")
        return payload

    @staticmethod
    def _number(value: Any) -> float | None:
        if isinstance(value, bool) or value is None:
            return None
        return round(float(value), 3)
