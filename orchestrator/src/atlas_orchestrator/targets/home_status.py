from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any, Callable

HomeAssistantReader = Callable[[str, str, float], dict[str, Any]]
HomeAssistantWriter = Callable[[str, str, float, float], None]
HomeAssistantImageReader = Callable[[str, str, str, float], tuple[bytes, str]]
HomeAssistantStreamReader = Callable[[str, str, str, float], tuple[Any, str]]
HomeAssistantHistoryReader = Callable[[str, str, float, int], list[dict[str, Any]]]


class HomeStatusTarget:
    name = "home-status"
    writable = False
    environment_entities = {
        "sensor.hvac_main_indoor_temperature": ("east-hallway-temperature", "Main Hall", "temperatures", "temperature"),
        "sensor.alex_office_sensor_temperature": ("office-temperature", "Office Sensor", "temperatures", "temperature"),
        "sensor.living_air_monitor_temperature": ("living-room-temperature", "Living Room", "temperatures", "temperature"),
        "sensor.bedroom_climate_temperature": ("primary-bedroom-temperature", "Primary Bedroom", "temperatures", "temperature"),
        "sensor.bathroom_leak_sensor_device_temperature": ("primary-bath-temperature", "Primary Bath", "temperatures", "temperature"),
        "sensor.laundry_leak_sensor_device_temperature": ("laundry-temperature", "Laundry", "temperatures", "temperature"),
        "sensor.kitchen_sink_temperature": ("kitchen-temperature", "Kitchen", "temperatures", "temperature"),
        "sensor.garage_leak_sensor_device_temperature": ("garage-temperature", "Garage", "utility", "temperature"),
        "sensor.hvac_leak_sensor_device_temperature": ("hvac-temperature", "HVAC Equipment", "utility", "temperature"),
        "sensor.water_heater_temperature": ("water-heater-temperature", "Water Heater", "utility", "temperature"),
        "sensor.refrigerator_fridge_temperature": ("refrigerator-temperature", "Refrigerator", "utility", "temperature"),
        "sensor.refrigerator_freezer_temperature": ("freezer-temperature", "Freezer", "utility", "temperature"),
        "sensor.hvac_main_indoor_humidity": ("east-hallway-humidity", "Main Hall", "humidity", "humidity"),
        "sensor.living_room_humidity_calibrated": ("living-room-humidity", "Living Room", "humidity", "humidity"),
        "sensor.bedroom_climate_humidity": ("primary-bedroom-humidity", "Primary Bedroom", "humidity", "humidity"),
        "sensor.living_air_monitor_humidity": ("air-monitor-humidity", "Air Monitor", "humidity", "humidity"),
        "sensor.kitchen_sink_humidity": ("kitchen-humidity", "Kitchen", "humidity", "humidity"),
        "sensor.water_heater_humidity": ("water-heater-humidity", "Water Heater Humidity", "utility", "humidity"),
        "sensor.living_air_monitor_air_quality_index": ("indoor-aqi", "Indoor AQI", "air_quality", "aqi"),
        "sensor.living_air_monitor_pm2_5": ("indoor-pm25", "PM2.5", "air_quality", "pm25"),
        "sensor.living_air_monitor_carbon_monoxide": ("indoor-carbon-monoxide", "Carbon Monoxide", "air_quality", "carbon_monoxide"),
        "sensor.living_air_monitor_volatile_organic_compounds_index": ("indoor-voc", "VOC Index", "air_quality", "voc"),
        "sensor.hvac_main_outdoor_air_temperature": ("outdoor-temperature", "Outdoor Temperature", "outdoor", "temperature"),
        "sensor.hvac_main_outdoor_humidity": ("outdoor-humidity", "Outdoor Humidity", "outdoor", "humidity"),
        "sensor.hvac_main_outdoor_aqi": ("outdoor-aqi", "Outdoor AQI", "outdoor", "aqi"),
    }
    history_entities = tuple(
        entity
        for entity, definition in environment_entities.items()
        if definition[2] in {"temperatures", "humidity", "utility"}
        or definition[0] == "outdoor-temperature"
    )
    celsius_entities = {
        "sensor.hvac_main_indoor_temperature",
        "sensor.hvac_main_outdoor_air_temperature",
    }

    def __init__(
        self,
        endpoint: str,
        token: str,
        timeout: float = 2.0,
        reader: HomeAssistantReader | None = None,
        writer: HomeAssistantWriter | None = None,
        history_reader: HomeAssistantHistoryReader | None = None,
    ) -> None:
        parsed = urllib.parse.urlsplit(endpoint)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Home Assistant endpoint must be loopback HTTP")
        self.endpoint = endpoint.rstrip("/")
        self.token = token.strip()
        self.timeout = timeout
        self._reader = reader or self._read
        self._writer = writer or self._write_temperature
        self._history_reader = history_reader or self._read_history

    def status(self) -> dict[str, Any]:
        if not self.token:
            return {
                "adapter": self.name,
                "status": "unavailable",
                "reason": "not_configured",
            }
        try:
            source = self._reader(self.endpoint, self.token, self.timeout)
            climate = source.get("climate", {})
            environment = source.get("environment", [])
            return {
                "adapter": self.name,
                "status": "healthy",
                "climate": {
                    "state": climate.get("state"),
                    "current_temperature": self._number(climate.get("current_temperature")),
                    "target_temperature": self._number(climate.get("target_temperature")),
                    "hvac_action": climate.get("hvac_action"),
                    "unit": climate.get("unit"),
                },
                "environment": self._normalize_environment(environment),
            }
        except Exception as exc:
            return {"adapter": self.name, "status": "unavailable", "reason": type(exc).__name__}

    def set_temperature(self, temperature: Any) -> dict[str, Any]:
        if not self.token:
            raise RuntimeError("Home Assistant access is not configured")
        if isinstance(temperature, bool):
            raise ValueError("temperature must be a number")
        try:
            target = float(temperature)
        except (TypeError, ValueError) as exc:
            raise ValueError("temperature must be a number") from exc
        if not math.isfinite(target) or target < 60 or target > 85:
            raise ValueError("temperature must be between 60 and 85°F")
        if round(target * 2) != target * 2:
            raise ValueError("temperature must use half-degree increments")
        target = round(target, 1)
        self._writer(self.endpoint, self.token, target, self.timeout)
        return {
            "adapter": self.name,
            "status": "accepted",
            "target_temperature": target,
            "snapshot": self.status(),
        }


    def environment_history(self, hours: int = 24) -> dict[str, Any]:
        if not self.token:
            return {
                "adapter": self.name,
                "status": "unavailable",
                "reason": "not_configured",
            }
        if hours != 24:
            raise ValueError("environment history is fixed at 24 hours")
        try:
            source = self._history_reader(self.endpoint, self.token, self.timeout + 8.0, hours)
            return {
                "adapter": self.name,
                "status": "healthy",
                "hours": hours,
                "series": self._normalize_history(source),
                "observed_at": datetime.now(UTC).isoformat(),
            }
        except Exception as exc:
            return {"adapter": self.name, "status": "unavailable", "reason": type(exc).__name__}

    @staticmethod
    def _read(endpoint: str, token: str, timeout: float) -> dict[str, Any]:
        entities = (
            "climate.hvac_main",
        )
        states: list[dict[str, Any]] = []
        for entity in entities:
            request = urllib.request.Request(
                f"{endpoint}/api/states/{entity}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                    "User-Agent": "Atlas-Home-Status/1",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read(250_000))
            if not isinstance(payload, dict):
                raise ValueError("Home Assistant state must be an object")
            states.append(payload)

        environment: list[dict[str, Any]] = []
        for entity, (key, label, group, kind) in HomeStatusTarget.environment_entities.items():
            try:
                payload = HomeStatusTarget._read_state(endpoint, token, entity, timeout)
            except Exception:
                continue
            attributes = payload.get("attributes", {})
            environment.append(
                {
                    "id": key,
                    "label": label,
                    "group": group,
                    "kind": kind,
                    "state": payload.get("state"),
                    "unit": attributes.get("unit_of_measurement"),
                }
            )

        climate_attributes = states[0].get("attributes", {})
        return {
            "climate": {
                "state": states[0].get("state"),
                "current_temperature": climate_attributes.get("current_temperature"),
                "target_temperature": climate_attributes.get("temperature"),
                "hvac_action": climate_attributes.get("hvac_action"),
                "unit": climate_attributes.get("temperature_unit")
                or climate_attributes.get("unit_of_measurement"),
            },
            "environment": environment,
        }


    @staticmethod
    def _read_state(endpoint: str, token: str, entity: str, timeout: float) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{endpoint}/api/states/{entity}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "Atlas-Home-Status/1",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read(250_000))
        if not isinstance(payload, dict):
            raise ValueError("Home Assistant state must be an object")
        return payload

    @staticmethod
    def _read_history(endpoint: str, token: str, timeout: float, hours: int) -> list[dict[str, Any]]:
        started = datetime.now(UTC) - timedelta(hours=hours)
        period = urllib.parse.quote(started.isoformat(), safe="")
        filters = urllib.parse.urlencode(
            {
                "filter_entity_id": ",".join(HomeStatusTarget.history_entities),
                "minimal_response": "",
                "no_attributes": "",
            }
        )
        request = urllib.request.Request(
            f"{endpoint}/api/history/period/{period}?{filters}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "Atlas-Environment-History/1",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read(5_000_000))
        if not isinstance(payload, list):
            raise ValueError("Home Assistant history must be an array")

        result: list[dict[str, Any]] = []
        for records in payload:
            if not isinstance(records, list) or not records:
                continue
            entity = records[0].get("entity_id")
            definition = HomeStatusTarget.environment_entities.get(entity)
            if definition is None:
                continue
            key, label, group, kind = definition
            result.append(
                {
                    "id": key,
                    "label": label,
                    "group": group,
                    "kind": kind,
                    "unit": records[0].get("attributes", {}).get("unit_of_measurement")
                    or ("°C" if entity in HomeStatusTarget.celsius_entities else None),
                    "points": [
                        {
                            "at": record.get("last_updated") or record.get("last_changed"),
                            "value": record.get("state"),
                        }
                        for record in records
                    ],
                }
            )
        return result

    @staticmethod
    def _write_temperature(endpoint: str, token: str, temperature: float, timeout: float) -> None:
        body = json.dumps(
            {
                "entity_id": "climate.hvac_main",
                "temperature": temperature,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{endpoint}/api/services/climate/set_temperature",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Atlas-Home-Control/1",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read(250_000)


    @staticmethod
    def _number(value: Any) -> float | None:
        if isinstance(value, bool) or value is None:
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(number):
            return None
        return round(number, 1)

    @classmethod
    def _measurement(cls, value: Any, unit: Any, kind: str) -> tuple[float | None, str]:
        number = cls._number(value)
        source_unit = str(unit or "")
        if number is None:
            return None, cls._unit(kind, source_unit)
        if kind == "temperature" and source_unit in {"°C", "C", "° C"}:
            return round((number * 9 / 5) + 32, 1), "°F"
        return number, cls._unit(kind, source_unit)

    @staticmethod
    def _unit(kind: str, source_unit: str) -> str:
        if kind == "temperature":
            return source_unit or "°F"
        if kind == "humidity":
            return "%"
        if kind == "aqi":
            return "AQI"
        if kind == "pm25":
            return "µg/m³"
        if kind == "carbon_monoxide":
            return "ppm"
        if kind == "voc":
            return "Index"
        return source_unit

    @classmethod
    def _normalize_environment(cls, source: Any) -> dict[str, list[dict[str, Any]]]:
        result: dict[str, list[dict[str, Any]]] = {
            "temperatures": [],
            "humidity": [],
            "air_quality": [],
            "outdoor": [],
            "utility": [],
        }
        if not isinstance(source, list):
            return result
        for reading in source:
            if not isinstance(reading, dict) or reading.get("group") not in result:
                continue
            value, unit = cls._measurement(reading.get("state"), reading.get("unit"), str(reading.get("kind")))
            if value is None:
                continue
            result[str(reading["group"])].append(
                {
                    "id": str(reading.get("id", "")),
                    "label": str(reading.get("label", "")),
                    "value": value,
                    "unit": unit,
                }
            )
        return result

    @classmethod
    def _normalize_history(cls, source: Any) -> list[dict[str, Any]]:
        if not isinstance(source, list):
            return []
        result: list[dict[str, Any]] = []
        for series in source:
            if not isinstance(series, dict):
                continue
            points = []
            for point in series.get("points", []):
                if not isinstance(point, dict) or not point.get("at"):
                    continue
                try:
                    value, unit = cls._measurement(point.get("value"), series.get("unit"), str(series.get("kind")))
                except (TypeError, ValueError):
                    continue
                if value is not None:
                    if (
                        str(series.get("id")) == "living-room-humidity"
                        and str(series.get("kind")) == "humidity"
                        and value < 20
                    ):
                        continue
                    points.append({"at": str(point["at"]), "value": value})
            if not points:
                continue
            if len(points) > 180:
                step = math.ceil(len(points) / 180)
                points = points[::step]
            _, unit = cls._measurement(points[0]["value"], "°F" if series.get("kind") == "temperature" else series.get("unit"), str(series.get("kind")))
            result.append(
                {
                    "id": str(series.get("id", "")),
                    "label": str(series.get("label", "")),
                    "metric": str(series.get("group", "")),
                    "unit": unit,
                    "points": points,
                }
            )
        return result
