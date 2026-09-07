from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from atlas_orchestrator.targets.household import HouseholdTarget


class HouseholdTargetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.target = HouseholdTarget(Path(self.temporary.name) / "household.sqlite3")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_profiles_and_messages_remain_local_and_profile_scoped(self):
        created = self.target.send("alex", "sam", "Dinner is ready")
        alex = self.target.status("alex")
        sam = self.target.status("sam")

        self.assertEqual({profile["id"] for profile in alex["profiles"]}, {"alex", "sam"})
        self.assertEqual(alex["unread"], 0)
        self.assertEqual(sam["unread"], 1)
        self.assertEqual(sam["messages"][0]["body"], "Dinner is ready")

        self.target.mark_read(created["message_id"], "sam")
        self.assertEqual(self.target.status("sam")["unread"], 0)

    def test_invalid_profiles_recipients_and_oversized_messages_fail_closed(self):
        with self.assertRaises(ValueError):
            self.target.status("guest")
        with self.assertRaises(ValueError):
            self.target.send("alex", "internet", "No external delivery")
        with self.assertRaises(ValueError):
            self.target.send("sam", "alex", "x" * 1001)

    def test_sam_switches_without_pin_and_alex_requires_configured_six_digits(self):
        self.assertEqual(self.target.switch_profile("sam")["status"], "accepted")
        self.assertFalse(self.target.status("sam")["alex_pin_configured"])
        self.assertEqual(self.target.switch_profile("alex", "123456")["status"], "not_configured")

        configured = self.target.set_pin("alex", "123456")
        self.assertEqual(configured["status"], "configured")
        self.assertTrue(self.target.status("sam")["alex_pin_configured"])
        self.assertEqual(self.target.switch_profile("alex", "000000")["status"], "denied")
        self.assertEqual(self.target.switch_profile("alex", "123456")["status"], "accepted")

        with self.assertRaises(ValueError):
            self.target.set_pin("alex", "12345")


if __name__ == "__main__":
    unittest.main()
