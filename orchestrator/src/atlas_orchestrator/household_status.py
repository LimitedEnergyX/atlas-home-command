"""Fresh, read-only household answers. Sensor states never authorize actions."""
from __future__ import annotations
import json
import re
import urllib.request
from datetime import datetime, UTC
from .household_tools import LIGHT_NAMES, TV_NAMES

LEAKS = {
    'binary_sensor.garage_leak_moisture': 'Garage',
    'binary_sensor.hvac_leak_moisture': 'HVAC',
    'binary_sensor.laundry_leak_moisture': 'Laundry',
    'binary_sensor.main_bath_leak_moisture': 'Master bath',
    'binary_sensor.kitchen_sink_leak_moisture': 'Kitchen sink',
    'binary_sensor.water_heater_leak_moisture': 'Water heater',
}
DOORS = {
    'binary_sensor.refrigerator_fridge_door': 'Refrigerator',
    'binary_sensor.refrigerator_freezer_door': 'Freezer',
}

class HouseholdStatus:
    def __init__(self, tools, reader=None):
        self.tools = tools
        self.reader = reader or self._read_states

    @staticmethod
    def groups(message):
        text = message.lower().strip()
        if not re.match(r'^(?:are|is|do|does|what|how|check|show|tell|status)\b', text):
            return []
        if re.search(r'\b(?:and|then)\s+(?:turn|switch|set|close|open|start|stop|disable|enable)\b', text):
            return []
        groups = []
        for name, pattern in {
            'leaks': r'\b(?:leaks?|leak sensors?|water sensors?)\b',
            'dryer': r'\bdryer\b',
            'washer': r'\bwasher\b',
            'doors': r'\b(?:doors?|garage)\b',
            'hvac': r'\b(?:hvac|thermostat|temperature|ac)\b',
            'lights': r'\b(?:lights?|porch|hallway)\b',
            'tvs': r'\b(?:tv|tvs|televisions?)\b',
        }.items():
            if re.search(pattern, text):
                groups.append(name)
        # Do not answer historical, maintenance, battery, or procedural questions with current on/off states.
        if re.search(r'\b(?:yesterday|history|historical|battery|batteries|maintenance|install|repair|why|when|how to|how do|volume|mute|input|source|channel|color|colour|brightness|humidity|watts|power consumption)\b', text):
            return []
        if 'leaks' in groups:
            groups = [group for group in groups if group not in {'doors', 'hvac'}]
        # Refrigerator temperatures are not thermostat temperatures.
        if re.search(r'\b(?:fridge|refrigerator|freezer)\b', text) and re.search(r'\btemperature\b', text):
            return []
        if any(group in groups for group in ('dryer', 'washer')) and 'hvac' in groups and not re.search(r'\b(?:hvac|thermostat|ac)\b', text):
            return []
        return groups

    def answer(self, message):
        groups = self.groups(message)
        if not groups:
            return None
        evidence, answers, uncertain = [], [], False
        try:
            states = self.reader() if self.tools.token else []
            if not isinstance(states, list):
                raise ValueError('invalid state list')
            by_id = {s.get('entity_id'): s for s in states if isinstance(s, dict)}
        except Exception:
            by_id = {}

        def read(entity, expected_class=None):
            nonlocal uncertain
            state = by_id.get(entity, {})
            value = state.get('state')
            attrs = state.get('attributes') or {}
            if state.get('entity_id') != entity or value in {None, 'unknown', 'unavailable'} or (expected_class and attrs.get('device_class') != expected_class):
                value = None
                uncertain = True
            evidence.append({'entity_id': entity, 'state': value, 'unit': attrs.get('unit_of_measurement'), 'last_updated': state.get('last_updated')})
            return value, attrs

        if 'leaks' in groups:
            dry, wet, unknown = [], [], []
            for entity, label in LEAKS.items():
                value, _ = read(entity, 'moisture')
                (dry if value == 'off' else wet if value == 'on' else unknown).append(label)
            if len(dry) == len(LEAKS):
                answers.append(f'All {len(LEAKS)} configured leak sensors report dry.')
            else:
                if dry:
                    answers.append(f'{len(dry)} configured leak sensors report dry.')
                if wet:
                    answers.append('Wet readings: ' + ', '.join(wet) + '.')
                if unknown:
                    uncertain = True
                    answers.append("I can't verify these leak sensors: " + ', '.join(unknown) + '.')
        for appliance in ('dryer', 'washer'):
            if appliance not in groups:
                continue
            machine, _ = read(f'sensor.{appliance}_machine_state')
            job, _ = read(f'sensor.{appliance}_job_state')
            if machine == 'stop':
                answers.append(f'The {appliance} reports stopped' + (f'; job state: {job}.' if job not in {None, 'none'} else '.'))
            elif machine is not None:
                label = {'run': 'running', 'pause': 'paused'}.get(machine, machine)
                answers.append(f'The {appliance} reports {label}' + (f'; job state: {job}.' if job not in {None, 'none'} else '.'))
            else:
                answers.append(f"I can't verify whether the {appliance} is running.")
        if 'doors' in groups:
            text = message.lower()
            specific = bool(re.search(r'\b(?:fridge|refrigerator|freezer|garage)\b', text))
            for entity, label in DOORS.items():
                if specific and not re.search(r'\b(?:fridge|refrigerator)\b' if label == 'Refrigerator' else r'\bfreezer\b', text):
                    continue
                value, _ = read(entity, 'door')
                if value in {'on', 'off'}:
                    answers.append(f'The {label.lower()} door reports ' + ('open.' if value == 'on' else 'closed.'))
                else:
                    uncertain = True
                    answers.append(f"I can't verify the {label.lower()} door.")
            entity = self.tools.garage_entity
            if (not specific or 'garage' in text) and re.fullmatch(r'cover\.[a-z0-9_]+', entity or ''):
                value, _ = read(entity, 'garage')
                answers.append(f'The garage reports {value}.' if value in {'open', 'closed', 'opening', 'closing'} else "I can't verify the garage door.")
                if value not in {'open', 'closed', 'opening', 'closing'}:
                    uncertain = True
            elif not specific or 'garage' in text:
                uncertain = True
                answers.append("I can't verify the garage door; no control is configured.")
        if 'hvac' in groups:
            entity = 'climate.main_thermostat'
            try:
                by_id[entity] = self.tools.reader(entity, 3)
            except Exception:
                by_id.pop(entity, None)
            value, attrs = read(entity)
            if value is None:
                answers.append("I can't verify the thermostat.")
            else:
                answers.append(f'The thermostat reports {value} mode.')
                unit = attrs.get('temperature_unit')
                if unit in {'°F', '°C'}:
                    for key, label in (('current_temperature', 'Current temperature'), ('temperature', 'Target')):
                        number = attrs.get(key)
                        if isinstance(number, (int, float)) and not isinstance(number, bool):
                            answers.append(f'{label}: {number:g}{unit}.')
                else:
                    uncertain = True
                    answers.append("Temperature units couldn't be verified.")
                if attrs.get('fan_mode'):
                    answers.append(f"Fan mode: {attrs['fan_mode']}.")
        if 'lights' in groups:
            text = message.lower()
            selected = [entity for entity, names in LIGHT_NAMES.items() if any(name in text for name in names)] or list(LIGHT_NAMES)
            for entity in selected:
                names = LIGHT_NAMES[entity]
                value, _ = read(entity)
                answers.append(f'{names[0].capitalize()}: {value}.' if value in {'on', 'off'} else f"{names[0].capitalize()}: unavailable.")
                if value not in {'on', 'off'}:
                    uncertain = True
        if 'tvs' in groups:
            text = message.lower()
            selected = [e for e, names in TV_NAMES.items() if ('43' if '43' in e else '65') in text] or list(TV_NAMES)
            for entity in selected:
                value, _ = read(entity, 'tv')
                label = TV_NAMES[entity][0]
                answers.append(f'The {label} reports {value}.' if value in {'on', 'off', 'playing', 'paused', 'idle', 'buffering'} else f"I can't verify the {label}; it is unavailable.")
                if value not in {'on', 'off', 'playing', 'paused', 'idle', 'buffering'}:
                    uncertain = True
        return {'status': 'partial' if uncertain else 'answered', 'answer': ' '.join(answers), 'observed_at': datetime.now(UTC).isoformat(), 'evidence': evidence, 'read_only': True}

    def _read_states(self):
        request = urllib.request.Request(self.tools.endpoint + '/api/states', headers={'Authorization': 'Bearer ' + self.tools.token})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read(2_000_000))
