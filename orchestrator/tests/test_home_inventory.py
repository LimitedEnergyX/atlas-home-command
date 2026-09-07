from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.targets.home_inventory import HomeInventoryTarget  # noqa: E402


class HomeInventoryTests(unittest.TestCase):
    def test_minimizes_attributes_and_groups_entities(self):
        target = HomeInventoryTarget(
            "http://127.0.0.1:8123",
            "token",
            reader=lambda *_args: [
                {"entity_id": "sensor.room_temperature", "state": "72", "attributes": {"friendly_name": "Room", "device_class": "temperature", "unit_of_measurement": "°F", "secret": "hidden"}},
                {"entity_id": "binary_sensor.leak", "state": "off", "attributes": {"friendly_name": "Leak", "device_class": "moisture"}},
                {"entity_id": "light.lamp", "state": "unavailable", "attributes": {"friendly_name": "Lamp"}},
            ],
        )
        result = target.status()
        self.assertEqual(result["summary"]["entities"], 2)
        self.assertEqual(result["summary"]["unavailable"], 0)
        self.assertEqual(result["summary"]["filtered"], 1)
        self.assertEqual(result["groups"]["safety"][0]["name"], "Leak")
        self.assertNotIn("secret", result["groups"]["climate"][0])

    def test_filters_noisy_entities_and_summarizes_backup_health(self):
        target = HomeInventoryTarget(
            "http://127.0.0.1:8123",
            "token",
            reader=lambda *_args: [
                {"entity_id": "sensor.phone_essid", "state": "wifi", "attributes": {}},
                {"entity_id": "media_player.echo", "state": "idle", "attributes": {}},
                {"entity_id": "sensor.backup_backup_manager_state", "state": "idle", "attributes": {}},
                {"entity_id": "sensor.backup_last_successful_automatic_backup", "state": "unavailable", "attributes": {}},
                {"entity_id": "sensor.backup_next_scheduled_automatic_backup", "state": "unavailable", "attributes": {}},
            ],
        )
        result = target.status()
        self.assertEqual([item["entity_id"] for item in result["groups"]["backup"]], ["sensor.backup_backup_manager_state"])
        self.assertEqual(result["backup"]["status"], "needs_attention")
        self.assertEqual(result["summary"]["entities"], 1)

    def test_uses_current_local_backup_when_container_has_no_backup_agent(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            snapshot = Path(temporary_directory) / "storage-2026-08-20"
            snapshot.mkdir()
            (snapshot / "core.config").write_text("{}", encoding="utf-8")
            target = HomeInventoryTarget(
                "http://127.0.0.1:8123",
                "token",
                backup_root=temporary_directory,
                reader=lambda *_args: [
                    {"entity_id": "sensor.backup_backup_manager_state", "state": "idle", "attributes": {}},
                    {"entity_id": "sensor.backup_last_successful_automatic_backup", "state": "unavailable", "attributes": {}},
                    {"entity_id": "sensor.backup_next_scheduled_automatic_backup", "state": "unavailable", "attributes": {}},
                ],
            )

            backup = target.status()["backup"]

            self.assertEqual(backup["status"], "healthy")
            self.assertEqual(backup["source"], "atlas-local")
            self.assertEqual(backup["next_scheduled"], "Daily at 3:00 AM")
            self.assertIsNotNone(backup["last_successful"])

    def test_household_control_is_allowlisted(self):
        writes = []
        target = HomeInventoryTarget(
            "http://127.0.0.1:8123",
            "token",
            writer=lambda endpoint, token, entity_id, enabled, timeout: writes.append(
                (endpoint, token, entity_id, enabled, timeout)
            ),
        )
        result = target.set_control("light.driveway_light", True)
        self.assertEqual(result["state"], "on")
        self.assertEqual(writes[0][2:4], ("light.driveway_light", True))
        with self.assertRaises(ValueError):
            target.set_control("switch.alex_s_echo_dot_max_do_not_disturb", True)
        with self.assertRaises(ValueError):
            target.set_control("switch.refrigerator_power_cool", True)
        with self.assertRaises(ValueError):
            target.set_control("switch.desk_plug", True)

    def test_only_intended_lights_are_exposed_and_offline_lights_remain_visible(self):
        target = HomeInventoryTarget(
            "http://127.0.0.1:8123",
            "token",
            reader=lambda *_args: [
                {"entity_id": "light.entry_light_left", "state": "unavailable", "attributes": {"friendly_name": "Front Porch Left"}},
                {"entity_id": "light.driveway_light", "state": "off", "attributes": {"friendly_name": "Driveway Light"}},
                {"entity_id": "switch.desk_plug", "state": "off", "attributes": {"friendly_name": "Kitchen Plug"}},
                {"entity_id": "switch.refrigerator_power_freeze", "state": "off", "attributes": {"friendly_name": "Power Freeze"}},
            ],
        )

        result = target.status()
        controls = result["groups"]["home_controls"]

        self.assertEqual([item["entity_id"] for item in controls], ["light.driveway_light", "light.entry_light_left"])
        self.assertEqual(result["summary"]["available"], 1)
        self.assertEqual(result["summary"]["unavailable"], 1)
        self.assertFalse(controls[1]["controllable"])


if __name__ == "__main__":
    unittest.main()
