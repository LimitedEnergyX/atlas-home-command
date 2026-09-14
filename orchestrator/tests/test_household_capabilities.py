from __future__ import annotations
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from atlas_orchestrator.household_tools import HouseholdTools, TV_NAMES, authorized_commands
from atlas_orchestrator.household_status import HouseholdStatus, LEAKS, DOORS
from atlas_orchestrator.core import AtlasOrchestrator
from atlas_orchestrator.config import Settings
from atlas_orchestrator.providers.fake import FakeProvider


class CapabilityTests(unittest.TestCase):
    def setUp(self):
        self.now, self.writes = 0, []
        self.states = {
            **{e: {'entity_id': e, 'state': 'off', 'attributes': {'device_class': 'tv', 'supported_features': 384}} for e in TV_NAMES},
            **{e: {'entity_id': e, 'state': 'off', 'attributes': {'device_class': 'moisture'}} for e in LEAKS},
            **{e: {'entity_id': e, 'state': 'off', 'attributes': {'device_class': 'door'}} for e in DOORS},
            'cover.garage': {'entity_id': 'cover.garage', 'state': 'closed', 'attributes': {'device_class': 'garage'}},
            'climate.main_thermostat': {'entity_id': 'climate.main_thermostat', 'state': 'cool', 'attributes': {
                'temperature': 74, 'current_temperature': 73.5, 'temperature_unit': '°F', 'supported_features': 8,
                'hvac_modes': ['auto', 'heat', 'cool', 'off'], 'fan_modes': ['auto', 'on', 'low', 'Schedule'], 'fan_mode': 'auto'}},
            **{f'sensor.{a}_{k}_state': {'entity_id': f'sensor.{a}_{k}_state', 'state': v, 'attributes': {}}
               for a in ('dryer', 'washer') for k, v in (('machine', 'stop'), ('job', 'none'))},
        }
        self.tools = HouseholdTools('http://localhost', 'dummy', garage_entity='cover.garage', reader=self.read,
                                    writer=self.write, clock=lambda: self.now, sleep=self.sleep)
        self.status = HouseholdStatus(self.tools, reader=lambda: list(self.states.values()))

    def read(self, entity, timeout): return self.states[entity]
    def sleep(self, seconds): self.now += seconds
    def write(self, domain, service, body, timeout):
        self.writes.append((domain, service, body.copy()))
        state = self.states[body['entity_id']]
        if service == 'set_hvac_mode': state['state'] = body['hvac_mode']
        elif service == 'set_fan_mode': state['attributes']['fan_mode'] = body['fan_mode']
        else: state['state'] = 'on' if service == 'turn_on' else 'off'
    def command(self, text, dry_run=False):
        return self.tools.execute(authorized_commands(text), text, dry_run=dry_run)

    def test_tv_power_and_verified_noop(self):
        self.assertEqual(self.command('turn on the living room TV')['status'], 'completed')
        self.assertEqual(self.writes[0][:2], ('media_player', 'turn_on'))
        self.assertEqual(self.command('turn on the living room TV')['results'][0]['status'], 'already_satisfied')
        self.assertEqual(len(self.writes), 1)
        self.assertEqual(self.command('turn off the living room TV')['status'], 'completed')

    def test_playing_tv_is_already_on(self):
        self.states['media_player.living_room_tv']['state'] = 'playing'
        self.assertEqual(self.command('turn on the living room TV')['status'], 'completed')
        self.assertEqual(self.writes, [])

    def test_tv_unavailable_wrong_class_or_capability_never_writes(self):
        tv = self.states['media_player.bedroom_tv']
        for state, cls, features in [('unavailable', 'tv', 384), ('off', 'speaker', 384), ('off', 'tv', 0), ('surprise', 'tv', 384)]:
            with self.subTest(state=state, cls=cls, features=features):
                tv.update(state=state, attributes={'device_class': cls, 'supported_features': features})
                self.assertEqual(self.command('turn on the bedroom TV')['status'], 'incomplete')
                self.assertEqual(self.writes, [])

    def test_both_tvs_keep_partial_result(self):
        self.states['media_player.bedroom_tv']['state'] = 'unavailable'
        result = self.command('turn on both TVs')
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(len(result['results']), 2)
        self.assertEqual(len(self.writes), 1)

    def test_ambiguous_and_unapproved_commands_denied(self):
        for text in ['turn on TV', 'start the dryer', 'disable the camera', 'turn on the living room TV and start the dryer',
                     'turn on the living room TV if everyone is home', 'turn on the living room TV and turn it off']:
            with self.subTest(text=text):
                self.assertIsNone(authorized_commands(text))
                self.assertEqual(self.command(text)['status'], 'blocked')
        self.assertEqual(self.writes, [])

    def test_hvac_mode_and_fan_services(self):
        self.assertEqual(self.command('set HVAC mode to heat')['status'], 'completed')
        self.assertEqual(self.writes[-1], ('climate', 'set_hvac_mode', {'entity_id': 'climate.main_thermostat', 'hvac_mode': 'heat'}))
        self.assertEqual(self.command('set HVAC fan to low')['status'], 'completed')
        self.assertEqual(self.writes[-1][1], 'set_fan_mode')
        self.assertEqual(self.command('set HVAC fan to schedule')['status'], 'completed')
        self.assertEqual(self.writes[-1][2]['fan_mode'], 'Schedule')

    def test_hvac_unadvertised_capabilities_denied(self):
        self.assertEqual(self.command('set HVAC fan to high')['status'], 'incomplete')
        self.states['climate.main_thermostat']['attributes']['supported_features'] = 0
        self.assertEqual(self.command('set HVAC fan to low')['status'], 'incomplete')
        self.states['climate.main_thermostat']['attributes']['hvac_modes'] = ['cool']
        self.assertEqual(self.command('set HVAC mode to heat')['status'], 'incomplete')
        self.assertEqual(self.writes, [])

    def test_dry_runs_send_nothing(self):
        for text in ['turn on both TVs', 'set HVAC mode to heat', 'set HVAC fan to low']:
            self.assertEqual(self.command(text, True)['status'], 'preview')
        self.assertEqual(self.writes, [])

    def test_lost_ack_is_not_retried(self):
        def lost(*args):
            self.writes.append(args)
            raise TimeoutError()
        self.tools.writer = lost
        self.assertEqual(self.command('turn on the living room TV')['status'], 'incomplete')
        self.assertEqual(len(self.writes), 1)

    def test_leaks_dry_wet_unknown(self):
        self.assertIn('All 6 configured leak sensors report dry', self.status.answer('Are all leak sensors dry?')['answer'])
        self.states[next(iter(LEAKS))]['state'] = 'on'
        self.assertIn('Wet readings: Garage', self.status.answer('Check the leak sensors')['answer'])
        self.states[next(iter(LEAKS))]['state'] = 'unknown'
        result = self.status.answer('Are all leak sensors dry?')
        self.assertEqual(result['status'], 'partial')
        self.assertNotIn('All 6', result['answer'])
        self.assertEqual(self.writes, [])

    def test_wrong_sensor_class_is_not_dry(self):
        self.states[next(iter(LEAKS))]['attributes']['device_class'] = 'door'
        self.assertEqual(self.status.answer('Are all leak sensors dry?')['status'], 'partial')

    def test_specific_door_and_leak_queries_do_not_include_thermostat(self):
        result = self.status.answer('Is the refrigerator door open?')
        self.assertIn('refrigerator door reports closed', result['answer'])
        self.assertEqual(len(result['evidence']), 1)
        self.assertNotIn('thermostat', self.status.answer('Is the HVAC leak sensor dry?')['answer'])
        self.assertIsNone(self.status.answer('What is the refrigerator temperature?'))

    def test_running_and_stopped_appliances(self):
        self.assertIn('dryer reports stopped', self.status.answer('Is the dryer running?')['answer'])
        self.states['sensor.dryer_machine_state']['state'] = 'run'
        self.assertIn('dryer reports running', self.status.answer('Is the dryer running?')['answer'])
        self.states['sensor.dryer_machine_state']['state'] = 'unavailable'
        self.assertEqual(self.status.answer('Is the dryer running?')['status'], 'partial')

    def test_tv_and_temperature_status(self):
        self.states['media_player.bedroom_tv']['state'] = 'unavailable'
        result = self.status.answer('Are the TVs on?')
        self.assertEqual(result['status'], 'partial')
        self.assertIn('bedroom tv', result['answer'])
        self.assertIn('living room tv reports off', result['answer'])
        self.assertIn('73.5°F', self.status.answer('What is the thermostat temperature?')['answer'])
        self.states['climate.main_thermostat']['attributes'].pop('temperature_unit')
        self.assertEqual(self.status.answer('What is the thermostat temperature?')['status'], 'partial')

    def test_status_failure_and_unsafe_compound(self):
        for text in ['What is the TV volume?', 'What input is the TV using?', 'What is the dryer temperature?', 'Is the refrigerator running?']:
            self.assertIsNone(self.status.answer(text))
        self.status.reader = lambda: (_ for _ in ()).throw(ConnectionError())
        self.assertEqual(self.status.answer('Are all leak sensors dry?')['status'], 'partial')
        self.assertIsNone(self.status.answer('Are the TVs on and start the dryer'))
        self.assertIsNone(self.status.answer('How do I repair the dryer?'))
        self.assertIsNone(self.status.answer('Were the leak sensors dry yesterday?'))
        self.assertEqual(self.writes, [])

    def test_status_chat_does_not_call_model_or_writer(self):
        class NoInference(FakeProvider):
            def generate(self, request, timeout_seconds): raise AssertionError('Status must not use a model')
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'ATLAS_HOME_ASSISTANT_TOKEN': ''}):
            app = AtlasOrchestrator(Settings(Path(tmp), retry_budget=0), {'ollama': NoInference('ollama')})
            app.household_status = self.status
            result = app.chat({'message': 'Are all leak sensors dry?', 'mode': 'local'})
            self.assertEqual(result['status'], 'answered')
            self.assertEqual(result['route']['provider'], 'home-assistant')
            self.assertIsNone(result['execution'])
            self.assertTrue(result['observation']['read_only'])
            self.assertTrue(app.ledger.health())
            self.assertEqual(self.writes, [])


if __name__ == '__main__': unittest.main()
