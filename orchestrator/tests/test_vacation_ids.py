from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.targets.vacation_ids import VacationIDSTarget  # noqa: E402


class VacationIDSTests(unittest.TestCase):
    def target(self, root: Path, states: dict[str, str] | None = None) -> VacationIDSTarget:
        values = states or {}
        return VacationIDSTarget(
            "http://127.0.0.1:8123",
            "token",
            root,
            reader=lambda _endpoint, _token, entity, _timeout: {"state": values.get(entity, "off")},
            notifier=lambda *_args: None,
            start_monitor=False,
        )

    def test_defaults_disarmed_and_requires_exact_confirmation(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.target(Path(directory))
            self.assertFalse(target.status()["armed"])
            with self.assertRaises(ValueError):
                target.set_armed(True, "yes")
            result = target.set_armed(True, "ARM VACATION IDS")
            self.assertTrue(result["armed"])
            self.assertFalse(result["primary_alarm_integrated"])
            self.assertFalse(target.set_armed(False)["armed"])

    def test_refuses_to_arm_with_unavailable_sensor(self):
        with tempfile.TemporaryDirectory() as directory:
            entity = next(iter(VacationIDSTarget.sensors))
            target = self.target(Path(directory), {entity: "unavailable"})
            with self.assertRaises(RuntimeError):
                target.set_armed(True, "ARM VACATION IDS")


if __name__ == "__main__":
    unittest.main()
