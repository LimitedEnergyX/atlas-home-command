"""Least-privilege chat tools. Model proposals never grant execution authority."""
from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from collections import Counter
from typing import Any

from .targets.home_inventory import HomeInventoryTarget

LIGHT_NAMES = {
    "light.driveway_light": ("driveway", "driveway light"),
    "light.main_hall_light": ("east hallway", "east hallway light"),
    "light.entry_light_left": ("porch left", "front porch left", "left porch light"),
    "light.entry_light_right": ("porch right", "front porch right", "right porch light"),
    "switch.desk_plug_sams_light": ("sam's light", "sams light"),
    "switch.desk_plug_alexs_light": ("alex's light", "alexs light"),
}
_COMMAND_LOCK = threading.Lock()
TV_NAMES = {
    "media_player.bedroom_tv": ('bedroom tv', 'bedroom tv', '43" tv', 'bedroom television'),
    "media_player.living_room_tv": ('living room tv', 'living room tv', '65" tv', 'living room television'),
}
HVAC_MODES = {'auto', 'heat', 'cool', 'off'}
FAN_MODES = {'auto', 'on', 'low', 'medium', 'high', 'Schedule'}


def authorized_commands(message: str) -> list[dict[str, Any]] | None:
    """Independent, conservative authorization grammar for the CURRENT message only.

    Conversation history, model output, and device labels cannot authorize writes.
    Unsupported/conditional/quoted language is never partially treated as permission.
    """
    text = message.lower().strip().replace("’", "'").rstrip(".!?")
    text = re.sub(r"^(?:please |can you |could you |hey atlas[, ]+|hermes[, ]+)", "", text)
    parts = re.split(r"\s+(?:and|then)\s+|\s*,\s*", text)
    commands = []
    for part in parts:
        part = re.sub(r"^please\s+", "", part.strip()).strip()
        if re.fullmatch(r"close (?:the |my |our )?garage(?: door)?", part):
            commands.append({"tool": "close_garage", "target": "garage", "value": True})
            continue
        target = re.fullmatch(r"set (?:the |my |our )?(?:temp|temperature|thermostat|hvac)(?: target)? (?:to |at )?(\d+(?:\.\d+)?)(?:\s*(?:degrees?|°))?(?:\s*(?:f|fahrenheit))?", part)
        if target:
            commands.append({"tool": "set_temperature", "target": "thermostat", "value": float(target[1])})
            continue
        mode = re.fullmatch(r"set (?:the )?(?:hvac|thermostat|ac)(?: mode)? (?:to )?(auto|heat|cool|off)", part)
        fan = re.fullmatch(r"set (?:the )?(?:hvac|thermostat|ac) fan(?: mode)? (?:to )?(auto|on|low|medium|high|schedule)", part)
        if mode or fan:
            value = (mode or fan)[1]
            commands.append({'tool': 'set_hvac_mode' if mode else 'set_fan_mode', 'target': 'thermostat', 'value': 'Schedule' if value == 'schedule' else value})
            continue
        light = re.fullmatch(r"(?:turn|switch) (?:the )?(on|off) (.+)", part)
        if light:
            enabled, name = light[1] == "on", light[2]
        else:
            light = re.fullmatch(r"(?:turn|switch) (?:the )?(.+) (on|off)", part)
            if not light:
                return None
            name, enabled = light[1], light[2] == "on"
        name = name.strip().removeprefix('the ')
        tv_ids = list(TV_NAMES) if name in {'all tvs', 'both tvs', 'all televisions', 'both televisions'} else [entity for entity, aliases in TV_NAMES.items() if name in aliases]
        if tv_ids:
            commands.extend({'tool': 'set_tv_power', 'target': entity, 'value': enabled} for entity in tv_ids)
            continue
        ids = list(LIGHT_NAMES) if name in {"all lights", "all the lights"} else [entity for entity, aliases in LIGHT_NAMES.items() if name in aliases]
        if not ids:
            return None
        commands.extend({"tool": "set_light", "target": entity, "value": enabled} for entity in ids)
    if len(commands) > 8:
        return None
    # Do not accept two conflicting directives for the same device in one request.
    if len({item["target"] for item in commands}) != len(commands):
        return None
    return commands or None


def command_signature(command: dict[str, Any]) -> tuple:
    if not isinstance(command, dict) or set(command) != {"tool", "target", "value"}:
        raise ValueError("invalid command fields")
    tool, target, value = command["tool"], command["target"], command["value"]
    if not isinstance(tool, str) or not isinstance(target, str):
        raise ValueError("invalid command target")
    if tool == "set_temperature":
        if target != "thermostat" or isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 60 <= value <= 85 or int(value) != value:
            raise ValueError("thermostat target must be a whole number from 60 to 85°F")
    elif tool == "set_light":
        if target not in HomeInventoryTarget.household_control_entities or not isinstance(value, bool):
            raise ValueError("light is not an approved control")
    elif tool == "close_garage":
        if target != "garage" or value is not True:
            raise ValueError("only garage closure is approved")
    elif tool == 'set_tv_power':
        if target not in TV_NAMES or not isinstance(value, bool):
            raise ValueError('TV is not an approved power control')
    elif tool in {'set_hvac_mode', 'set_fan_mode'}:
        if target != 'thermostat' or not isinstance(value, str) or value not in (HVAC_MODES if tool == 'set_hvac_mode' else FAN_MODES):
            raise ValueError('HVAC setting is not approved')
    else:
        raise ValueError("tool is not approved")
    return tool, target, value


def looks_like_household_command(message: str) -> bool:
    """Unsupported imperative commands must not fall back to a model success claim."""
    text = message.lower().strip()
    text = re.sub(r"^(?:please |can you |could you |hey atlas[, ]+|hermes[, ]+)", "", text)
    return bool(re.search(r"(?:^(?:close|open|turn|switch|set|start|stop|enable|disable)|\b(?:and|then)\s+(?:close|open|turn|switch|set|start|stop|enable|disable))\b.*\b(?:garage|door|lights?|porch|hallway|tv|tvs|television|temp|temperature|thermostat|hvac|ac|dryer|washer|refrigerator|camera|alarm|siren)\b", text))


class HouseholdTools:
    def __init__(self, endpoint: str, token: str, *, garage_entity: str | None = None,
                 reader=None, writer=None, timeout: float = 40, clock=time.monotonic, sleep=time.sleep):
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.garage_entity = garage_entity if garage_entity is not None else os.environ.get("ATLAS_GARAGE_ENTITY_ID", "")
        self.reader = reader or self._read
        self.writer = writer or self._write
        self.timeout, self.clock, self.sleep = timeout, clock, sleep

    def catalog(self) -> list[dict[str, Any]]:
        return [
            {"tool": "set_temperature", "target": "thermostat", "value": "integer 60..85°F"},
            {"tool": "close_garage", "target": "garage", "value": True, "configured": bool(self.garage_entity)},
            {'tool': 'set_hvac_mode', 'target': 'thermostat', 'value': sorted(HVAC_MODES)},
            {'tool': 'set_fan_mode', 'target': 'thermostat', 'value': sorted(FAN_MODES)},
            *[{'tool': 'set_tv_power', 'target': entity, 'aliases': list(aliases), 'value': 'boolean'} for entity, aliases in TV_NAMES.items()],
            *[{"tool": "set_light", "target": entity, "aliases": list(aliases), "value": "boolean"} for entity, aliases in LIGHT_NAMES.items()],
        ]

    def execute(self, proposal: Any, message: str, *, dry_run: bool = False) -> dict[str, Any]:
        authorized = authorized_commands(message)
        try:
            if not authorized or not isinstance(proposal, list) or not 1 <= len(proposal) <= 8:
                raise ValueError("request needs a clear, supported command")
            expected = Counter(command_signature(item) for item in authorized)
            actual = Counter(command_signature(item) for item in proposal)
            if expected != actual:
                raise ValueError("model proposal does not match the complete current request")
        except (ValueError, TypeError) as exc:
            return {"status": "blocked", "answer": f"I couldn't safely perform that request: {exc}. Nothing was changed.", "results": []}
        if not _COMMAND_LOCK.acquire(timeout=1):
            return {"status": "blocked", "answer": "Another household command is in progress. Please try again shortly. Nothing was changed.", "results": []}
        try:
            deadline = self.clock() + self.timeout
            results = [self._execute_one(item, deadline, dry_run=dry_run) for item in authorized]
        finally:
            _COMMAND_LOCK.release()
        complete = all(item["status"] in {"verified", "already_satisfied"} for item in results)
        status = "preview" if dry_run else "completed" if complete else "incomplete"
        return {"status": status, "answer": " ".join(item["answer"] for item in results), "results": results}

    def _execute_one(self, command: dict[str, Any], deadline: float, *, dry_run: bool = False) -> dict[str, Any]:
        tool, target, value = command_signature(command)
        climate_tool = tool in {'set_temperature', 'set_hvac_mode', 'set_fan_mode'}
        label = "The garage" if tool == "close_garage" else "The thermostat" if climate_tool else TV_NAMES[target][0].capitalize() if tool == 'set_tv_power' else LIGHT_NAMES[target][0].capitalize()
        desired = "closed" if tool == "close_garage" else f"set to {int(value)}°F" if tool == "set_temperature" else f"in {value} mode" if tool == 'set_hvac_mode' else f"using {value} fan mode" if tool == 'set_fan_mode' else "on" if value else "off"
        def result(status, answer):
            return {"tool": tool, "target": target, "value": value, "status": status, "answer": answer}
        try:
            if not self.token:
                return result("unavailable", f"{label} couldn't be checked: Home Assistant access is not configured.")
            entity = self.garage_entity if tool == "close_garage" else "climate.main_thermostat" if climate_tool else target
            if tool == "close_garage" and not re.fullmatch(r"cover\.[a-z0-9_]+", entity):
                return result("unavailable", "I can't close or verify the garage: no garage-door control is configured.")
            def read():
                remaining = deadline - self.clock()
                if remaining <= 0:
                    raise TimeoutError()
                state = self.reader(entity, min(3, remaining))
                if not isinstance(state, dict) or state.get("entity_id") != entity:
                    raise ValueError("unexpected state response")
                if state.get("state") in {None, "unknown", "unavailable"}:
                    raise ConnectionError()
                if tool == "close_garage" and state.get("attributes", {}).get("device_class") != "garage":
                    raise ValueError("configured cover is not a garage")
                return state
            def satisfied(state):
                attrs = state.get('attributes', {})
                if tool in {'set_hvac_mode', 'set_fan_mode'}:
                    capability = 'hvac_modes' if tool == 'set_hvac_mode' else 'fan_modes'
                    if value not in attrs.get(capability, []):
                        raise ValueError('HVAC does not advertise that setting')
                    if tool == 'set_fan_mode' and not int(attrs.get('supported_features', 0)) & 8:
                        raise ValueError('HVAC fan control is unsupported')
                    return state.get('state') == value if tool == 'set_hvac_mode' else attrs.get('fan_mode') == value
                if tool == 'set_tv_power':
                    if attrs.get('device_class') != 'tv' or not int(attrs.get('supported_features', 0)) & (128 if value else 256):
                        raise ValueError('TV power capability is not confirmed')
                    return state.get('state') in {'on', 'playing', 'paused', 'idle', 'buffering'} if value else state.get('state') == 'off'
                if tool == "set_temperature":
                    attrs = state.get("attributes", {})
                    if attrs.get("temperature_unit") != "°F":
                        raise ValueError("thermostat Fahrenheit units are not confirmed")
                    return attrs.get("temperature") == value
                return state.get("state") == ("closed" if tool == "close_garage" else "on" if value else "off")
            state = read()
            if satisfied(state):
                return result("already_satisfied", f"{label} was already {desired}.")
            if tool == "set_light" and state.get("state") not in {"on", "off"}:
                return result("blocked", f"{label} has an unexpected state, so I didn't send a command.")
            if tool == 'set_tv_power' and state.get('state') not in {'on', 'off', 'playing', 'paused', 'idle', 'buffering'}:
                return result('blocked', f"{label} has an unexpected state, so I didn't send a command.")
            if dry_run:
                return result("preview", f"Would request {label.lower()} be {desired}. No command was sent.")
            if tool == "close_garage" and state.get("state") not in {"open", "closing"}:
                return result("blocked", "The garage isn't in a confirmed open or closing state, so I didn't send a command.")
            # An already-closing door is observed, not commanded again.
            if not (tool == "close_garage" and state["state"] == "closing"):
                remaining = deadline - self.clock()
                if remaining <= 0:
                    raise TimeoutError()
                if tool == "close_garage":
                    domain, service, body = "cover", "close_cover", {"entity_id": entity}
                elif tool == "set_temperature":
                    domain, service, body = "climate", "set_temperature", {"entity_id": entity, "temperature": value}
                elif tool in {'set_hvac_mode', 'set_fan_mode'}:
                    key = 'hvac_mode' if tool == 'set_hvac_mode' else 'fan_mode'
                    domain, service, body = 'climate', tool, {'entity_id': entity, key: value}
                else:
                    domain, service, body = entity.partition(".")[0], "turn_on" if value else "turn_off", {"entity_id": entity}
                # No automatic POST retries: a lost response may still have applied.
                try:
                    self.writer(domain, service, body, min(5, remaining))
                except Exception:
                    # Verify even after a transport error before reporting failure.
                    if satisfied(read()):
                        return result("verified", f"{label} is {desired}.")
                    return result("unverified", f"I couldn't confirm {label.lower()} is {desired} after the command. I didn't retry it.")
            tool_deadline = min(deadline, self.clock() + (25 if tool in {'close_garage', 'set_tv_power'} else 6))
            while self.clock() < tool_deadline:
                state = read()
                if satisfied(state):
                    return result("verified", f"{label} is {desired}.")
                self.sleep(min(.5, max(0, tool_deadline - self.clock())))
            return result("unverified", f"{label} hasn't confirmed it is {desired} yet.")
        except TimeoutError:
            return result("unverified", f"{label} couldn't be verified before the request timed out.")
        except ConnectionError:
            return result("unavailable", f"{label} is unavailable. I can't confirm its state.")
        except Exception:
            return result("failed", f"{label} couldn't be checked or updated through Home Assistant. Its state is unverified.")

    def _read(self, entity: str, timeout: float) -> dict[str, Any]:
        request = urllib.request.Request(f"{self.endpoint}/api/states/{urllib.parse.quote(entity, safe='')}", headers={"Authorization": f"Bearer {self.token}"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            state = json.loads(response.read(200_000))
        if entity == "climate.main_thermostat" and isinstance(state, dict):
            # HA climate entities do not normally include their configured units.
            config_request = urllib.request.Request(f"{self.endpoint}/api/config", headers={"Authorization": f"Bearer {self.token}"})
            with urllib.request.urlopen(config_request, timeout=timeout) as response:
                config = json.loads(response.read(200_000))
            attrs = state.setdefault("attributes", {})
            attrs.setdefault("temperature_unit", config.get("unit_system", {}).get("temperature"))
        return state

    def _write(self, domain: str, service: str, body: dict, timeout: float) -> None:
        request = urllib.request.Request(f"{self.endpoint}/api/services/{domain}/{service}", data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read(200_000)
