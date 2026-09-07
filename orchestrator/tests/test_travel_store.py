from __future__ import annotations
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, UTC, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from atlas_orchestrator.travel_store import TravelStore
from atlas_orchestrator.targets.travel import TravelTarget


class TravelStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "travel.json"
        self.path.write_text(json.dumps({"version": 2, "traveler_profile": {"preferred_card": "Example Travel Card"}, "trips": []}), encoding="utf-8")
        self.store = TravelStore(self.path)
        self.original = self.path.read_bytes()
        self.handoff = {"schema_version": 1, "base_revision": self.store.read()[1], "update_id": "test-1", "actor": "Test",
                        "reason": "Verified Update", "observed_at": "2026-01-01T12:00:00-06:00", "evidence": ["saved-log.md"],
                        "uncertainty": "No provider check performed", "operations": [{"collection": "trips", "id": "test", "previous": None,
                        "value": {"id": "test", "title": "Test Trip", "trip_type": "personal", "reservations": [], "charges": []}}]}

    def test_preview_does_not_write_and_apply_keeps_atomic_audit(self):
        self.assertEqual(self.store.update(self.handoff)["status"], "validated-preview")
        self.assertEqual(self.path.read_bytes(), self.original)
        result = self.store.update(self.handoff, apply=True)
        payload, revision = self.store.read()
        self.assertEqual(result["revision"], revision)
        self.assertEqual(result["status"], "applied-and-verified")
        self.assertEqual(payload["traveler_profile"]["preferred_card"], "Example Travel Card")
        self.assertEqual(payload["_audit"][0]["changes"][0]["previous"], None)
        self.assertEqual(payload["_audit"][0]["changes"][0]["value"], payload["trips"][0])
        self.assertEqual(TravelTarget(self.path).status()["audit"][0]["update_id"], "test-1")

    def test_household_review_persists_without_changing_provider_facts(self):
        trip = self.handoff["operations"][0]["value"]
        trip.update(start_date="2099-01-01", end_date="2099-01-04", reservations=[{"type": "Flight", "status": "ticketed", "required": True}])
        self.store.update(self.handoff, apply=True)
        body = {"trip_id": "test", "revision": self.store.read()[1], "profile": "alex", "confirmed": True,
                "checks": ["bookings", "documents", "costs", "transport"]}
        self.store.confirm_review(body)
        result = TravelTarget(self.path).status()
        self.assertTrue(result["trips"][0]["departure"]["good_to_go"])
        self.assertFalse(result["trips"][0]["departure"]["ready"])
        raw = self.store.read()[0]["trips"][0]
        self.assertEqual(raw["reservations"], trip["reservations"])
        self.assertEqual(raw["charges"], trip["charges"])
        self.assertNotIn("coverage", raw)
        with self.assertRaises(ValueError):
            self.store.confirm_review(body)
        # Changing itinerary facts invalidates a household review.
        raw["reservations"][0]["notes"] = "New departure time"
        normalized = TravelTarget.normalize_payload({"trips": [raw]})
        self.assertFalse(normalized["trips"][0]["departure"]["good_to_go"])

    def test_household_review_rejects_partial_or_unconfirmed(self):
        for checks, confirmed in [(["bookings"], True), (["bookings", "documents", "costs", "transport"], False)]:
            with self.assertRaises(ValueError):
                self.store.confirm_review({"trip_id": "test", "revision": self.store.read()[1], "profile": "alex", "confirmed": confirmed, "checks": checks})
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_rejects_conflicting_revision_previous_or_duplicate_id(self):
        for change in ({"base_revision": "stale"}, {"operations": [dict(self.handoff["operations"][0], previous={})]}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.store.update(dict(self.handoff, **change), apply=True)
            self.assertEqual(self.path.read_bytes(), self.original)
        self.store.update(self.handoff, apply=True)
        self.handoff["base_revision"] = self.store.read()[1]
        with self.assertRaises(ValueError):
            self.store.update(self.handoff, apply=True)

    def test_rejects_secrets_nan_bad_types_and_unproven_coverage(self):
        invalid = [
            {"password": "no"}, {"title": "4111111111111111"}, {"charges": [{"amount": float("nan")}]},
            {"charges": [{"amount": "250.50"}]}, {"charges": [{"miles": -1}]},
            {"reservations": [{"status": "not-needed", "required": True}]},
            {"coverage": [{"status": "verified"}]}, {"departure_checks": [{"label": "Check In", "status": "verified"}]},
            {"evidence": "not a list"}, {"charges": [{"card_number": "secret"}]},
        ]
        for fields in invalid:
            handoff = copy.deepcopy(self.handoff)
            handoff["operations"][0]["value"].update(fields)
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.store.update(handoff, apply=True)
            self.assertEqual(self.path.read_bytes(), self.original)

    def test_failure_to_replace_leaves_original_and_no_applied_audit(self):
        with patch("atlas_orchestrator.travel_store.os.replace", side_effect=OSError("test failure")):
            with self.assertRaises(OSError):
                self.store.update(self.handoff, apply=True)
        self.assertEqual(self.path.read_bytes(), self.original)
        self.assertFalse(self.path.with_suffix(".update.lock").exists())
        self.assertEqual(list(self.path.parent.glob("*.tmp")), [])

    def test_lock_rejects_concurrent_update_without_removing_lock(self):
        lock = self.path.with_suffix(".update.lock")
        lock.touch()
        with self.assertRaises(ValueError):
            self.store.update(self.handoff, apply=True)
        self.assertTrue(lock.exists())
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_timezone_and_evidence_required(self):
        for fields in ({"observed_at": "2026-01-01"}, {"evidence": []}, {"schema_version": 9}):
            with self.assertRaises(ValueError):
                self.store.update(dict(self.handoff, **fields), apply=True)

    def test_retains_past_trips_and_never_infers_departure_or_coverage(self):
        trip = self.handoff["operations"][0]["value"]
        trip.update({"start_date": "2020-01-01", "end_date": "2020-01-02", "reservations": [{"type": "Flight", "status": "ticketed"}],
                     "charges": [{"amount": 100, "card": "Example Travel Card", "status": "paid"}]})
        self.store.update(self.handoff, apply=True)
        data = TravelTarget(self.path).status()
        self.assertEqual(data["trips"], [])
        self.assertEqual(len(data["past_trips"]), 1)
        trip = data["past_trips"][0]
        self.assertTrue(trip["readiness"]["all_verified"])
        self.assertFalse(trip["departure"]["ready"])
        self.assertEqual(trip["coverage"], [])

    def test_expired_checks_do_not_count_as_departure_ready(self):
        now = datetime.now(UTC)
        trip = self.handoff["operations"][0]["value"]
        trip["reservations"] = [{"type": "Flight", "status": "ticketed"}]
        trip["departure_checks"] = [{"label": "Flight Status", "status": "verified", "verified_at": (now-timedelta(days=2)).isoformat(),
                                     "valid_until": (now-timedelta(days=1)).isoformat(), "evidence": ["provider"]}]
        self.store.update(self.handoff, apply=True)
        self.assertFalse(TravelTarget(self.path).status()["trips"][0]["departure"]["ready"])

    def test_exact_rewards_cash_fees_and_currencies_stay_separate(self):
        self.handoff["operations"][0]["value"]["charges"] = [
            {"redemption": True, "miles": 25000, "cash_fees": 11.20, "status": "paid", "currency": "USD", "reward_program": "SkyMiles"},
            {"amount": 250.50, "status": "expected", "currency": "USD"},
            {"amount": 200, "status": "expected", "currency": "EUR"},
        ]
        self.store.update(self.handoff, apply=True)
        costs = TravelTarget(self.path).status()["trips"][0]["costs"]
        self.assertEqual(costs["paid"], {"USD": 11.2})
        self.assertEqual(costs["miles"], {"SkyMiles": 25000})
        self.assertEqual(costs["later"], {"USD": 250.50, "EUR": 200})
        self.assertEqual(costs["unknown_paid"], 0)

    def test_unknown_redemption_never_claims_zero_fees(self):
        self.handoff["operations"][0]["value"]["charges"] = [{"redemption": True, "amount_label": "Paid With Miles", "status": "paid"}]
        self.store.update(self.handoff, apply=True)
        costs = TravelTarget(self.path).status()["trips"][0]["costs"]
        self.assertEqual(costs["paid"], {})
        self.assertEqual(costs["unknown_paid"], 1)
        self.assertEqual(costs["unknown_miles"], 1)


if __name__ == "__main__":
    unittest.main()
