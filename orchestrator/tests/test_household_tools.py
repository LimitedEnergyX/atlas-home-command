from __future__ import annotations
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from atlas_orchestrator.household_tools import HouseholdTools, authorized_commands, LIGHT_NAMES
from atlas_orchestrator.schemas import normalized_provider_output
from atlas_orchestrator.core import AtlasOrchestrator
from atlas_orchestrator.config import Settings
from atlas_orchestrator.providers.fake import FakeProvider


class HouseholdToolTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.writes = []
        self.states = {
            'cover.garage': {'entity_id': 'cover.garage', 'state': 'open', 'attributes': {'device_class': 'garage'}},
            'climate.main_thermostat': {'entity_id': 'climate.main_thermostat', 'state': 'cool', 'attributes': {'temperature': 73, 'temperature_unit': '°F'}},
            **{entity: {'entity_id': entity, 'state': 'off', 'attributes': {}} for entity in LIGHT_NAMES},
        }
        self.tools = HouseholdTools('http://127.0.0.1:17081', 'dummy', garage_entity='cover.garage', reader=self.read, writer=self.write, clock=lambda: self.now, sleep=self.sleep)

    def sleep(self, seconds): self.now += seconds
    def read(self, entity, timeout): return self.states[entity]
    def write(self, domain, service, body, timeout):
        self.writes.append((domain, service, body.copy()))
        state = self.states[body['entity_id']]
        if service == 'set_temperature': state['attributes']['temperature'] = body['temperature']
        else: state['state'] = 'closed' if service == 'close_cover' else 'on' if service == 'turn_on' else 'off'
    def run_command(self, message): return self.tools.execute(authorized_commands(message), message)

    def test_garage_closes_and_verifies(self):
        result = self.run_command('close the garage')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['answer'], 'The garage is closed.')
        self.assertEqual(self.writes[0][1], 'close_cover')

    def test_already_closed_sends_nothing(self):
        self.states['cover.garage']['state'] = 'closed'
        self.assertEqual(self.run_command('close the garage')['answer'], 'The garage was already closed.')
        self.assertEqual(self.writes, [])

    def test_closing_door_not_commanded_again(self):
        self.states['cover.garage']['state'] = 'closing'
        self.tools.reader = lambda entity, timeout: {**self.states[entity], 'state': 'closed' if self.now >= 1 else 'closing'}
        self.assertEqual(self.run_command('close the garage')['status'], 'completed')
        self.assertEqual(self.writes, [])

    def test_missing_garage_is_not_invented(self):
        self.tools.garage_entity = ''
        result = self.run_command('close the garage and set temp to 80 degrees')
        self.assertEqual(result['status'], 'incomplete')
        self.assertIn('no garage-door control', result['answer'])
        self.assertIn('thermostat is set to 80°F', result['answer'])
        self.assertEqual(len(self.writes), 1)

    def test_wrong_cover_class_never_moves(self):
        self.states['cover.garage']['attributes']['device_class'] = 'curtain'
        self.assertEqual(self.run_command('close the garage')['status'], 'incomplete')
        self.assertEqual(self.writes, [])

    def test_unavailable_garage_never_moves(self):
        self.states['cover.garage']['state'] = 'unavailable'
        self.assertIn('unavailable', self.run_command('close the garage')['answer'])
        self.assertEqual(self.writes, [])

    def test_temperature_noop_and_bounds(self):
        self.assertIn('already', self.run_command('set temp to 73')['answer'])
        for value in (59, 86, 80.5):
            self.assertEqual(self.run_command(f'set temp to {value}')['status'], 'blocked')
        self.assertEqual(self.writes, [])

    def test_wrong_temperature_units_never_writes(self):
        self.states['climate.main_thermostat']['attributes']['temperature_unit'] = '°C'
        self.assertEqual(self.run_command('set temp to 80')['status'], 'incomplete')
        self.assertEqual(self.writes, [])

    def test_lights_and_all_lights(self):
        self.assertEqual(self.run_command('turn on all lights')['status'], 'completed')
        self.assertEqual(len(self.writes), 6)
        self.assertEqual(self.run_command('turn the driveway light on')['status'], 'completed')
        self.assertEqual(len(self.writes), 6)

    def test_model_cannot_expand_or_omit_request(self):
        expected = authorized_commands('close the garage')
        for proposal in (expected + authorized_commands('set temp to 80'), [], [{'tool': 'open_garage', 'target': 'garage', 'value': True}], [{'tool':'set_light','target':'switch.unapproved','value':True}]):
            self.assertEqual(self.tools.execute(proposal, 'close the garage')['status'], 'blocked')
        self.assertEqual(self.tools.execute(expected, 'close the garage and set temp to 80')['status'], 'blocked')
        self.assertEqual(self.writes, [])

    def test_questions_negation_quotes_and_history_do_not_authorize(self):
        proposal = authorized_commands('close the garage')
        for message in ('hello', "don't close the garage", 'how do I close the garage?', 'if I leave, close the garage', 'pretend close the garage', 'close the garage and lock the front door', '"close the garage"', 'close the garage then open it'):
            self.assertIsNone(authorized_commands(message))
            self.assertEqual(self.tools.execute(proposal, message)['status'], 'blocked')
        self.assertEqual(self.writes, [])

    def test_lost_write_ack_can_still_verify_without_retry(self):
        def lost(domain, service, body, timeout):
            self.write(domain, service, body, timeout)
            raise TimeoutError()
        self.tools.writer = lost
        self.assertEqual(self.run_command('close the garage')['status'], 'completed')
        self.assertEqual(len(self.writes), 1)

    def test_dry_run_cannot_send_commands(self):
        message = 'close the garage and set temp to 80 and turn on all lights'
        result = self.tools.execute(authorized_commands(message), message, dry_run=True)
        self.assertEqual(result['status'], 'preview')
        self.assertEqual(len(result['results']), 8)
        self.assertEqual(self.writes, [])

    def test_accepted_is_not_completed(self):
        self.tools.writer = lambda *args: self.writes.append(args)
        result = self.run_command('close the garage')
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['results'][0]['status'], 'unverified')
        self.assertEqual(len(self.writes), 1)
        self.assertLessEqual(self.now, 40)

    def test_fenced_json_keeps_typed_proposals(self):
        output = {'recommendation':'Pending', 'reasoning_summary':'Plan only', 'assumptions':[], 'risks':[], 'confidence':.8, 'proposed_actions':[], 'tool_commands':authorized_commands('close the garage')}
        parsed = normalized_provider_output('```json\n'+json.dumps(output)+'\n```')
        self.assertEqual(parsed['tool_commands'], output['tool_commands'])

    def test_chat_end_to_end_overrides_unverified_model_claim(self):
        tools = self.tools
        class Planner(FakeProvider):
            def generate(self, request, timeout_seconds):
                output = super().generate(request, timeout_seconds)
                output['recommendation'] = 'Everything is done!'
                output['tool_commands'] = request['inputs']['authorized_household_commands']
                return output
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'ATLAS_HOME_ASSISTANT_TOKEN':''}):
            app = AtlasOrchestrator(Settings(Path(tmp), retry_budget=0), {'ollama':Planner('ollama')})
            app.household_tools = tools
            tools.garage_entity = ''
            result = app.chat({'message':'close the garage and set temp to 80'})
            self.assertEqual(result['status'], 'incomplete')
            self.assertNotIn('Everything is done', result['answer'])
            self.assertIn('no garage-door control', result['answer'])
            self.assertIn('80°F', result['answer'])
            unsupported = app.chat({'message':'close the garage and lock the front door'})
            self.assertEqual(unsupported['status'], 'blocked')
            self.assertNotIn('Everything is done', unsupported['answer'])


if __name__ == '__main__': unittest.main()
