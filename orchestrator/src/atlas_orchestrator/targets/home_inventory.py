from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Callable


HomeAssistantStatesReader = Callable[[str, str, float], list[dict[str, Any]]]
HomeAssistantControlWriter = Callable[[str, str, str, bool, float], None]


class HomeInventoryTarget:
    """Curated, attribute-minimized inventory of pertinent Home Assistant entities."""

    name = "home-inventory"
    writable = True
    household_control_entities = {
        "light.driveway_light",
        "light.main_hall_light",
        "light.entry_light_left",
        "light.entry_light_right",
        "switch.desk_plug_sams_light",
        "switch.desk_plug_alexs_light",
    }
    excluded_domains = {
        "automation",
        "button",
        "conversation",
        "device_tracker",
        "event",
        "media_player",
        "notify",
        "number",
        "person",
        "select",
        "sun",
        "todo",
        "tts",
        "update",
        "zone",
    }
    excluded_fragments = {
        "audio",
        "channel",
        "cloud_connection",
        "connectivity",
        "do_not_disturb",
        "essid",
        "fault_code",
        "firmware",
        "ip_address",
        "iphone",
        "location",
        "setpoint",
        "signal_strength",
        "sound",
        "tv_source",
    }
    backup_entities = {
        "manager": "sensor.backup_backup_manager_state",
        "last_attempted": "sensor.backup_last_attempted_automatic_backup",
        "last_successful": "sensor.backup_last_successful_automatic_backup",
        "next_scheduled": "sensor.backup_next_scheduled_automatic_backup",
    }
    group_labels = {
        "backup": "Backup Health",
        "climate": "Climate & Air",
        "energy": "Energy & Batteries",
        "home_controls": "Lights & Home Controls",
        "openings": "Doors & Openings",
        "safety": "Leaks & Safety",
        "security": "Motion & Security",
        "systems": "Appliances & Systems",
    }
    category_by_class = {
        "temperature": "climate",
        "humidity": "climate",
        "aqi": "climate",
        "carbon_monoxide": "climate",
        "pm1": "climate",
        "pm10": "climate",
        "pm25": "climate",
        "ozone": "climate",
        "moisture": "safety",
        "smoke": "safety",
        "gas": "safety",
        "door": "openings",
        "garage": "openings",
        "window": "openings",
        "motion": "security",
        "connectivity": "connectivity",
        "battery": "energy",
        "power": "energy",
        "energy": "energy",
    }

    def __init__(
        self,
        endpoint: str,
        token: str,
        timeout: float = 5.0,
        reader: HomeAssistantStatesReader | None = None,
        writer: HomeAssistantControlWriter | None = None,
        backup_root: str | Path | None = None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.token = token.strip()
        self.timeout = timeout
        self._reader = reader or self._read
        self._writer = writer or self._write_control
        self.backup_root = Path(backup_root) if backup_root else None

    def status(self) -> dict[str, Any]:
        if not self.token:
            return {"adapter": self.name, "status": "unavailable", "reason": "not_configured"}
        try:
            states = self._reader(self.endpoint, self.token, self.timeout)
            normalized = [self._normalize(item) for item in states if isinstance(item, dict)]
            backups = self._backup_summary(normalized)
            entities = [item for item in normalized if self._is_pertinent(item)]
            entities.sort(key=lambda item: (item["category"], item["name"].lower(), item["entity_id"]))
            domains = Counter(item["domain"] for item in entities)
            groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for item in entities:
                groups[item["category"]].append(item)
            return {
                "adapter": self.name,
                "status": "healthy",
                "summary": {
                    "entities": len(entities),
                    "available": sum(item["availability"] == "available" for item in entities),
                    "unavailable": sum(item["availability"] != "available" for item in entities),
                    "raw_entities": len(normalized),
                    "filtered": len(normalized) - len(entities),
                    "domains": dict(sorted(domains.items())),
                },
                "groups": dict(sorted(groups.items())),
                "group_labels": self.group_labels,
                "backup": backups,
                "observed_at": datetime.now(UTC).isoformat(),
            }
        except Exception as exc:
            return {"adapter": self.name, "status": "unavailable", "reason": type(exc).__name__}

    @classmethod
    def _normalize(cls, source: dict[str, Any]) -> dict[str, Any]:
        entity_id = str(source.get("entity_id") or "")
        domain = entity_id.partition(".")[0] or "unknown"
        attributes = source.get("attributes") if isinstance(source.get("attributes"), dict) else {}
        device_class = str(attributes.get("device_class") or "")
        category = cls.category_by_class.get(device_class, cls._domain_category(domain))
        category = cls._categorize_backup(entity_id, category)
        raw_state = source.get("state")
        availability = "unavailable" if raw_state in {None, "unknown", "unavailable"} else "available"
        state = None if availability == "unavailable" else raw_state
        if availability == "available" and device_class in {"temperature", "humidity"}:
            try:
                state = round(float(raw_state), 1)
            except (TypeError, ValueError):
                pass
        return {
            "entity_id": entity_id,
            "domain": domain,
            "category": category,
            "name": str(attributes.get("friendly_name") or entity_id),
            "state": state,
            "unit": attributes.get("unit_of_measurement"),
            "device_class": device_class or None,
            "availability": availability,
            "last_updated": source.get("last_updated"),
            "controllable": cls._is_controllable(entity_id, availability),
        }

    @classmethod
    def _is_pertinent(cls, item: dict[str, Any]) -> bool:
        entity_id = item["entity_id"].lower()
        if item["domain"] in cls.excluded_domains:
            return False
        if any(fragment in entity_id for fragment in cls.excluded_fragments):
            return False
        if item["category"] == "home_controls":
            return entity_id in cls.household_control_entities
        if item["availability"] != "available":
            return False
        if entity_id in cls.backup_entities.values():
            return item["category"] == "backup"
        if item["domain"] == "sensor" and item["category"] == "systems":
            return any(word in entity_id for word in ("washer", "dryer", "refrigerator", "water_heater", "backup"))
        return item["category"] in cls.group_labels

    @classmethod
    def _is_controllable(cls, entity_id: str, availability: str) -> bool:
        if availability != "available":
            return False
        if entity_id.endswith("_led"):
            return False
        return entity_id in cls.household_control_entities

    def _backup_summary(self, entities: list[dict[str, Any]]) -> dict[str, Any]:
        by_id = {item["entity_id"]: item for item in entities}
        values = {
            key: by_id.get(entity_id, {}).get("state")
            for key, entity_id in self.backup_entities.items()
        }
        populated = bool(values["last_successful"] and values["next_scheduled"])
        if populated:
            return {
                **values,
                "status": "healthy",
                "detail": "Automatic backups are scheduled and reporting",
                "source": "home-assistant",
            }

        local_backup = self._latest_local_backup()
        if local_backup:
            return {
                **values,
                "last_successful": local_backup.isoformat(),
                "next_scheduled": "Daily at 3:00 AM",
                "status": "healthy",
                "detail": "Atlas local Home Assistant backup is current",
                "source": "atlas-local",
            }
        return {
            **values,
            "status": "needs_attention",
            "detail": "Home Assistant backup timestamps are not populated",
            "source": "unavailable",
        }

    def _latest_local_backup(self) -> datetime | None:
        if not self.backup_root or not self.backup_root.is_dir():
            return None
        snapshots = [
            path
            for path in self.backup_root.glob("storage-*")
            if path.is_dir() and any(candidate.is_file() for candidate in path.rglob("*"))
        ]
        if not snapshots:
            return None
        modified = datetime.fromtimestamp(max(path.stat().st_mtime for path in snapshots), UTC)
        return modified if datetime.now(UTC) - modified <= timedelta(hours=36) else None

    def set_control(self, entity_id: Any, enabled: Any) -> dict[str, Any]:
        if not isinstance(entity_id, str) or not self._is_controllable(entity_id, "available"):
            raise ValueError("entity is not an approved Atlas household control")
        if not isinstance(enabled, bool):
            raise ValueError("enabled must be true or false")
        if not self.token:
            raise RuntimeError("Home Assistant access is not configured")
        self._writer(self.endpoint, self.token, entity_id, enabled, self.timeout)
        return {
            "adapter": self.name,
            "status": "accepted",
            "entity_id": entity_id,
            "state": "on" if enabled else "off",
        }

    @staticmethod
    def _domain_category(domain: str) -> str:
        return {
            "camera": "security",
            "event": "security",
            "siren": "security",
            "climate": "climate",
            "weather": "climate",
            "cover": "openings",
            "light": "home_controls",
            "switch": "home_controls",
            "number": "systems",
            "select": "systems",
            "binary_sensor": "systems",
            "sensor": "systems",
        }.get(domain, "systems")

    @classmethod
    def _categorize_backup(cls, entity_id: str, category: str) -> str:
        return "backup" if entity_id in cls.backup_entities.values() else category

    @staticmethod
    def _read(endpoint: str, token: str, timeout: float) -> list[dict[str, Any]]:
        request = urllib.request.Request(
            f"{endpoint}/api/states",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "Atlas-Home-Inventory/1",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read(12_000_000))
        if not isinstance(payload, list):
            raise ValueError("Home Assistant states must be an array")
        return payload

    @staticmethod
    def _write_control(endpoint: str, token: str, entity_id: str, enabled: bool, timeout: float) -> None:
        domain = entity_id.partition(".")[0]
        body = json.dumps({"entity_id": entity_id}).encode("utf-8")
        request = urllib.request.Request(
            f"{endpoint}/api/services/{urllib.parse.quote(domain)}/{('turn_on' if enabled else 'turn_off')}",
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
