from __future__ import annotations

import json
import threading
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable


StateReader = Callable[[str, str, str, float], dict[str, Any]]
Notifier = Callable[[str, str, str, str, float], None]


class VacationIDSTarget:
    """Deterministic, phone-only secondary IDS. It never controls the primary alarm."""

    name = "vacation-ids"
    writable = True
    sensors = {
        "binary_sensor.bedroom_motion": "Bedroom Sensor",
        "binary_sensor.living_room_motion": "Living Room Sensor",
        "binary_sensor.alex_office_sensor_motion": "Office Sensor",
    }
    confirmation_phrase = "ARM VACATION IDS"

    def __init__(
        self,
        endpoint: str,
        token: str,
        data_dir: Path,
        timeout: float = 3.0,
        poll_seconds: float = 5.0,
        cooldown_seconds: float = 180.0,
        reader: StateReader | None = None,
        notifier: Notifier | None = None,
        start_monitor: bool = True,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.token = token.strip()
        self.state_path = data_dir / "vacation-ids-state.json"
        self.events_path = data_dir / "vacation-ids-events.jsonl"
        self.timeout = timeout
        self.poll_seconds = poll_seconds
        self.cooldown_seconds = cooldown_seconds
        self._reader = reader or self._read_state
        self._notifier = notifier or self._notify_phone
        self._lock = threading.RLock()
        self._armed = False
        self._armed_at: str | None = None
        self._last_states: dict[str, str] = {}
        self._last_alert: dict[str, float] = {}
        self._load()
        if start_monitor:
            threading.Thread(target=self._monitor, name="atlas-vacation-ids", daemon=True).start()

    def status(self) -> dict[str, Any]:
        readings = self._readings()
        available = sum(item["availability"] == "available" for item in readings)
        active = [item["name"] for item in readings if item["state"] == "on"]
        with self._lock:
            armed = self._armed
            armed_at = self._armed_at
        return {
            "adapter": self.name,
            "status": "healthy" if available == len(readings) else "degraded",
            "armed": armed,
            "mode": "vacation-secondary-ids",
            "delivery": "home-assistant-phone-only",
            "primary_alarm_integrated": False,
            "armed_at": armed_at,
            "coverage": {"available": available, "total": len(readings)},
            "motion_active": active,
            "sensors": readings,
            "recent_events": self._recent_events(),
            "observed_at": datetime.now(UTC).isoformat(),
        }

    def set_armed(self, armed: Any, confirmation: Any = None, client_address: str = "") -> dict[str, Any]:
        if not isinstance(armed, bool):
            raise ValueError("armed must be true or false")
        readings = self._readings()
        if armed:
            if confirmation != self.confirmation_phrase:
                raise ValueError(f'arming requires confirmation phrase "{self.confirmation_phrase}"')
            unavailable = [item["name"] for item in readings if item["availability"] != "available"]
            if unavailable:
                raise RuntimeError("cannot arm while a required motion sensor is unavailable")
        now = datetime.now(UTC).isoformat()
        with self._lock:
            self._armed = armed
            self._armed_at = now if armed else None
            self._last_states = {item["entity_id"]: str(item["state"]) for item in readings}
            self._save()
        self._record("armed" if armed else "disarmed", {"client_address": client_address})
        return self.status()

    def _readings(self) -> list[dict[str, Any]]:
        readings = []
        for entity_id, name in self.sensors.items():
            try:
                source = self._reader(self.endpoint, self.token, entity_id, self.timeout)
                state = str(source.get("state") or "unavailable")
                availability = "unavailable" if state in {"unknown", "unavailable"} else "available"
                updated_at = source.get("last_updated") or source.get("last_changed")
            except Exception:
                state, availability, updated_at = "unavailable", "unavailable", None
            readings.append({
                "entity_id": entity_id,
                "name": name,
                "state": state,
                "availability": availability,
                "updated_at": updated_at,
            })
        return readings

    def _monitor(self) -> None:
        while True:
            try:
                with self._lock:
                    armed = self._armed
                if not armed:
                    time.sleep(self.poll_seconds)
                    continue
                readings = self._readings()
                with self._lock:
                    previous = dict(self._last_states)
                    self._last_states = {item["entity_id"]: str(item["state"]) for item in readings}
                now = time.monotonic()
                for item in readings:
                    entity = item["entity_id"]
                    if item["state"] != "on" or previous.get(entity) == "on":
                        continue
                    if now - self._last_alert.get(entity, 0) < self.cooldown_seconds:
                        continue
                    self._last_alert[entity] = now
                    message = f'{item["name"]} detected motion while the Atlas Vacation IDS is armed.'
                    self._notifier(self.endpoint, self.token, "Atlas Vacation IDS", message, self.timeout)
                    self._record("motion_alert", {"sensor": entity, "name": item["name"]})
            except Exception as exc:
                self._record("monitor_error", {"error": type(exc).__name__})
            time.sleep(self.poll_seconds)

    def _load(self) -> None:
        try:
            source = json.loads(self.state_path.read_text(encoding="utf-8"))
            self._armed = bool(source.get("armed", False))
            self._armed_at = source.get("armed_at") if self._armed else None
        except (OSError, ValueError, TypeError):
            self._armed = False
            self._armed_at = None

    def _save(self) -> None:
        self.state_path.write_text(
            json.dumps({"armed": self._armed, "armed_at": self._armed_at}, indent=2) + "\n",
            encoding="utf-8",
        )

    def _record(self, event: str, detail: dict[str, Any]) -> None:
        line = json.dumps({"at": datetime.now(UTC).isoformat(), "event": event, **detail}, sort_keys=True)
        with self._lock:
            with self.events_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")

    def _recent_events(self) -> list[dict[str, Any]]:
        try:
            lines = self.events_path.read_text(encoding="utf-8").splitlines()[-20:]
            return [json.loads(line) for line in reversed(lines) if line.strip()]
        except (OSError, ValueError):
            return []

    @staticmethod
    def _read_state(endpoint: str, token: str, entity: str, timeout: float) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{endpoint}/api/states/{entity}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "User-Agent": "Atlas-Vacation-IDS/1"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read(250_000))
        if not isinstance(payload, dict):
            raise ValueError("Home Assistant state must be an object")
        return payload

    @staticmethod
    def _notify_phone(endpoint: str, token: str, title: str, message: str, timeout: float) -> None:
        body = json.dumps({"title": title, "message": message, "data": {"push": {"sound": "default"}}}).encode("utf-8")
        request = urllib.request.Request(
            f"{endpoint}/api/services/notify/mobile_app_example_phone",
            data=body,
            method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "Atlas-Vacation-IDS/1"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read(250_000)
