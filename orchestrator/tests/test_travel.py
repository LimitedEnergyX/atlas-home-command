from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.targets.travel import TravelTarget  # noqa: E402


class TravelTargetTests(unittest.TestCase):
    def test_missing_ledger_is_a_healthy_empty_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = TravelTarget(Path(temporary) / "travel.json").status()
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["summary"]["upcoming"], 0)
        self.assertEqual(result["trips"], [])
        self.assertEqual(result["loyalty"], [])
        self.assertEqual(result["sources"], [])
        self.assertEqual(result["loyalty_summary"]["programs"], 0)
        self.assertIsNone(result["loyalty_summary"]["delta_lounge_visits_remaining"])
        self.assertIsNone(result["policy"]["preferred_card"])
        self.assertIsNone(result["policy"]["lounge_profile"]["card_product"])

    def test_program_without_its_own_balance_does_not_invent_one(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "travel.json"
            path.write_text(json.dumps({"loyalty": [{
                "program": "National Emerald Club",
                "provider": "National",
                "status": "Emerald Club",
                "benefits": ["Rental rewards currently credit to Delta SkyMiles"],
            }]}), encoding="utf-8")
            result = TravelTarget(path).status()
        program = result["loyalty"][0]
        self.assertIsNone(program["balance"])
        self.assertEqual(program["balance_label"], "")
        self.assertFalse(program["balance_verified"])

    def test_trip_readiness_and_charge_timing_are_computed(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "travel.json"
            path.write_text(json.dumps({
                "loyalty": [{
                    "id": "delta",
                    "program": "Delta SkyMiles",
                    "balance": 25000,
                    "balance_label": "25,000 miles",
                    "status": "Silver Medallion",
                    "member_id_masked": "•••• 0000",
                    "lounge_visits_remaining": 5,
                    "lounge_visits_verified_at": "2026-09-04",
                    "qualification": [{
                        "label": "MQDs Toward Gold",
                        "current": 6000,
                        "target": 10000,
                        "detail": "$500 Pending · $4,000 To Next Tier",
                    }],
                }],
                "sources": [{"provider": "Delta", "bookings_found": 1, "detail": "One trip"}],
                "trips": [{
                "id": "chicago-2027",
                "title": "Chicago",
                "preferred_card": "Example Travel Card",
                "destination": "Chicago, IL",
                "start_date": "2027-05-10",
                "end_date": "2027-05-13",
                "reservations": [
                    {"type": "Flight", "provider": "Delta", "status": "ticketed", "segments": [{
                        "flight_number": "DL123", "from": "AUS", "to": "ATL", "terminal": "Main",
                        "lounges": [{"name": "Delta Sky Club", "network": "Delta Sky Club", "access": "available", "basis": "Reserve Card"}],
                    }]},
                    {"type": "Hotel", "provider": "Hilton", "status": "confirmed"},
                    {"type": "Rental car", "provider": "National", "status": "needed"},
                ],
                "charges": [
                    {"merchant": "Delta", "amount": 420, "status": "charged", "card": "Example Travel Card"},
                    {"merchant": "National", "amount": 180, "status": "expected", "timing": "after trip", "card": "Example Travel Card"},
                ],
            }]}), encoding="utf-8")
            result = TravelTarget(path).status()
        trip = result["trips"][0]
        self.assertFalse(trip["readiness"]["all_verified"])
        self.assertEqual(trip["readiness"]["missing"], ["Rental car"])
        self.assertEqual(trip["financials"]["charged"], 420)
        self.assertEqual(trip["financials"]["later"], 180)
        self.assertTrue(trip["financials"]["preferred_card_used"])
        lounge = trip["reservations"][0]["segments"][0]["lounges"][0]
        self.assertEqual(lounge["name"], "Delta Sky Club")
        self.assertEqual(lounge["airport"], "AUS")
        self.assertEqual(lounge["access"], "available")
        self.assertEqual(result["loyalty_summary"]["programs"], 1)
        self.assertEqual(result["loyalty_summary"]["balances_verified"], 1)
        self.assertEqual(result["loyalty_summary"]["delta_lounge_visits_remaining"], 5)
        self.assertEqual(result["loyalty"][0]["lounge_visits_verified_at"], "2026-09-04")
        self.assertEqual(result["loyalty"][0]["member_id_masked"], "•••• 0000")
        self.assertEqual(result["loyalty"][0]["qualification"][0]["current"], 6000)
        self.assertEqual(result["loyalty"][0]["qualification"][0]["target"], 10000)
        self.assertEqual(result["sources"][0]["bookings_found"], 1)

    def test_unknown_charge_amounts_are_counted_without_becoming_zero_dollar_claims(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "travel.json"
            path.write_text(json.dumps({"trips": [{
                "title": "Example City",
                "start_date": "2027-10-24",
                "end_date": "2027-10-31",
                "reservations": [{"type": "Flight", "status": "ticketed"}],
                "charges": [
                    {"merchant": "Delta", "amount": None, "status": "charged"},
                    {"merchant": "National", "amount": None, "status": "expected"},
                ],
            }]}), encoding="utf-8")
            result = TravelTarget(path).status()
        financials = result["trips"][0]["financials"]
        self.assertEqual(financials["charged"], 0)
        self.assertEqual(financials["later"], 0)
        self.assertEqual(financials["unknown_charged"], 1)
        self.assertEqual(financials["unknown_later"], 1)

    def test_trip_type_business_expenses_and_reward_redemptions_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "travel.json"
            path.write_text(json.dumps({"trips": [{
                "title": "Client visit",
                "trip_type": "business",
                "start_date": "2027-11-01",
                "end_date": "2027-11-03",
                "reservations": [
                    {"type": "Flight", "status": "ticketed"},
                    {"type": "Hotel", "status": "not-needed", "required": False},
                ],
                "charges": [{
                    "merchant": "Delta",
                    "amount": None,
                    "amount_label": "Paid with SkyMiles",
                    "redemption": True,
                    "status": "paid",
                }],
                "business_expenses": {
                    "submission_status": "partial",
                    "reimbursed_amount": 125.50,
                    "remaining_amount": 74.50,
                },
            }]}), encoding="utf-8")
            result = TravelTarget(path).status()
        trip = result["trips"][0]
        self.assertEqual(trip["trip_type"], "business")
        self.assertEqual(trip["financials"]["redemptions"], 1)
        self.assertEqual(trip["financials"]["unknown_charged"], 0)
        self.assertEqual(trip["charges"][0]["amount_label"], "Paid with SkyMiles")
        self.assertEqual(trip["business_expenses"]["submission_status"], "partial")
        self.assertEqual(trip["business_expenses"]["reimbursed_amount"], 125.50)
        self.assertEqual(trip["business_expenses"]["remaining_amount"], 74.50)


if __name__ == "__main__":
    unittest.main()
