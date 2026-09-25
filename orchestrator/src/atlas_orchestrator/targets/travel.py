from __future__ import annotations

import json
import hashlib
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from .travel_evidence import enrich_trip, attention


CONFIRMED_STATES = {"confirmed", "reserved", "ticketed", "verified"}
PAID_STATES = {"charged", "paid"}


def _now() -> str:
    return datetime.now(UTC).isoformat()


class TravelTarget:
    """Read-only trip ledger for the native Atlas Travel module."""

    name = "travel"
    writable = False

    def __init__(self, path: Path) -> None:
        self.path = path

    def status(self) -> dict[str, Any]:
        payload = self._load()
        trips = payload["trips"]
        loyalty = payload["loyalty"]
        sources = payload["sources"]
        today = date.today().isoformat()
        upcoming = [trip for trip in trips if not trip.get("end_date") or trip["end_date"] >= today]
        upcoming.sort(key=lambda trip: (trip.get("start_date") or "9999-12-31", trip["title"]))
        past = [trip for trip in trips if trip.get("end_date") and trip["end_date"] < today]
        past.sort(key=lambda trip: trip["end_date"], reverse=True)
        ready = sum(1 for trip in upcoming if trip["readiness"]["all_verified"])
        charged = sum(trip["financials"]["charged"] for trip in upcoming)
        later = sum(trip["financials"]["later"] for trip in upcoming)
        unknown_charged = sum(trip["financials"]["unknown_charged"] for trip in upcoming)
        unknown_later = sum(trip["financials"]["unknown_later"] for trip in upcoming)
        redemptions = sum(trip["financials"]["redemptions"] for trip in upcoming)
        delta_lounge_visits_remaining = next(
            (
                item["lounge_visits_remaining"]
                for item in loyalty
                if (
                    item["provider"].casefold().startswith("delta")
                    or item["program"].casefold().startswith("delta")
                )
                and item["lounge_visits_remaining"] is not None
            ),
            None,
        )
        return {
            "adapter": self.name,
            "status": "healthy",
            "policy": {
                "preferred_card": None,
                "credentials": "Browser or Windows credential storage only; never the trip ledger",
                "purchase_authority": "Explicit operator approval required before booking",
                "lounge_profile": {
                    "card_product": None,
                    "candidate_networks": [],
                    "rule": "Verify each airport, terminal, airline, fare, visit allowance, guest policy, and USO eligibility before travel",
                    "verified_at": None,
                },
            },
            "summary": {
                "upcoming": len(upcoming),
                "ready": ready,
                "charged": round(charged, 2),
                "later": round(later, 2),
                "unknown_charges": unknown_charged + unknown_later,
                "unknown_charged": unknown_charged,
                "unknown_later": unknown_later,
                "redemptions": redemptions,
            },
            "loyalty_summary": {
                "programs": len(loyalty),
                "balances_verified": sum(1 for item in loyalty if item["balance_verified"]),
                "statuses_verified": sum(1 for item in loyalty if item["status"]),
                "programs_with_progress": sum(1 for item in loyalty if item["qualification"]),
                "delta_lounge_visits_remaining": delta_lounge_visits_remaining,
            },
            "trips": upcoming,
            "past_trips": past,
            "cases": payload["cases"],
            "attention": attention(upcoming, payload["cases"]),
            "monitor": payload["monitor"],
            "ledger_updated_at": payload["ledger_updated_at"],
            "audit": payload["audit"],
            "loyalty": loyalty,
            "sources": sources,
            "observed_at": _now(),
            "revision": payload.get("revision", ""),
        }

    def _load(self) -> dict[str, list[dict[str, Any]]]:
        if not self.path.exists():
            return self.normalize_payload({})
        raw = self.path.read_bytes()
        payload = self.normalize_payload(json.loads(raw.decode("utf-8-sig")))
        payload["revision"] = hashlib.sha256(raw).hexdigest()
        return payload

    @staticmethod
    def normalize_payload(payload):
        raw_trips = payload.get("trips", []) if isinstance(payload, dict) else []
        raw_loyalty = payload.get("loyalty", []) if isinstance(payload, dict) else []
        raw_sources = payload.get("sources", []) if isinstance(payload, dict) else []
        if not isinstance(raw_trips, list) or not isinstance(raw_loyalty, list) or not isinstance(raw_sources, list):
            raise ValueError("travel data trips, loyalty, and sources must be lists")
        return {
            "trips": [enrich_trip(TravelTarget._normalize_trip(item, index), item) for index, item in enumerate(raw_trips)],
            "loyalty": [TravelTarget._normalize_loyalty(item, index) for index, item in enumerate(raw_loyalty)],
            "sources": [TravelTarget._normalize_source(item) for item in raw_sources if isinstance(item, dict)],
            "cases": payload.get("cases", []),
            "monitor": payload.get("monitor", []),
            "ledger_updated_at": (payload.get("_audit") or [{}])[-1].get("applied_at", ""),
            "audit": [{k: entry.get(k) for k in ("update_id", "actor", "reason", "observed_at", "applied_at", "evidence", "uncertainty")}
                      for entry in payload.get("_audit", [])[-10:]][::-1],
        }

    @staticmethod
    def _normalize_loyalty(item: Any, index: int) -> dict[str, Any]:
        if not isinstance(item, dict):
            raise ValueError("each loyalty program must be an object")
        balance = item.get("balance")
        try:
            normalized_balance = float(balance) if balance is not None else None
        except (TypeError, ValueError):
            normalized_balance = None
        lounge_visits = item.get("lounge_visits_remaining")
        try:
            normalized_lounge_visits = max(0, int(lounge_visits)) if lounge_visits is not None else None
        except (TypeError, ValueError):
            normalized_lounge_visits = None
        raw_qualification = item.get("qualification", [])
        qualification = []
        if isinstance(raw_qualification, list):
            for metric in raw_qualification:
                if not isinstance(metric, dict):
                    continue
                qualification.append(
                    {
                        "label": str(metric.get("label") or "Status progress").strip(),
                        "current": metric.get("current"),
                        "target": metric.get("target"),
                        "detail": str(metric.get("detail") or "").strip(),
                    }
                )
        benefits = item.get("benefits", [])
        return {
            "id": str(item.get("id") or f"loyalty-{index + 1}").strip(),
            "program": str(item.get("program") or "Travel rewards").strip(),
            "provider": str(item.get("provider") or item.get("program") or "Provider").strip(),
            "balance": normalized_balance,
            "balance_label": str(item.get("balance_label") or "").strip(),
            "balance_unit": str(item.get("balance_unit") or "points").strip(),
            "balance_verified": bool(item.get("balance_verified", normalized_balance is not None)),
            "lounge_visits_remaining": normalized_lounge_visits,
            "lounge_visits_verified_at": str(item.get("lounge_visits_verified_at") or "").strip(),
            "status": str(item.get("status") or "").strip(),
            "member_id_masked": str(item.get("member_id_masked") or "").strip(),
            "member_since": str(item.get("member_since") or "").strip(),
            "qualification": qualification,
            "benefits": [str(value).strip() for value in benefits if str(value).strip()]
            if isinstance(benefits, list)
            else [],
            "verified_at": str(item.get("verified_at") or "").strip(),
            "evidence": item.get("evidence", []),
            "notes": str(item.get("notes") or "").strip(),
        }

    @staticmethod
    def _normalize_source(item: dict[str, Any]) -> dict[str, Any]:
        try:
            bookings_found = max(0, int(item.get("bookings_found") or 0))
        except (TypeError, ValueError):
            bookings_found = 0
        return {
            "provider": str(item.get("provider") or "Travel provider").strip(),
            "status": str(item.get("status") or "checked").strip().lower(),
            "bookings_found": bookings_found,
            "detail": str(item.get("detail") or "").strip(),
            "verified_at": str(item.get("verified_at") or "").strip(),
            "session_status": str(item.get("session_status") or "unknown"),
            "session_checked_at": str(item.get("session_checked_at") or ""),
            "evidence": item.get("evidence", []),
        }

    @staticmethod
    def _normalize_trip(item: Any, index: int) -> dict[str, Any]:
        if not isinstance(item, dict):
            raise ValueError("each trip must be an object")
        trip_id = str(item.get("id") or f"trip-{index + 1}").strip()
        title = str(item.get("title") or item.get("destination") or "Planned Trip").strip()
        trip_type = str(item.get("trip_type") or "unclassified").strip().lower()
        if trip_type not in {"business", "personal"}:
            trip_type = "unclassified"
        reservations = item.get("reservations", [])
        charges = item.get("charges", [])
        if not isinstance(reservations, list) or not isinstance(charges, list):
            raise ValueError("trip reservations and charges must be lists")

        normalized_reservations = []
        for reservation in reservations:
            if not isinstance(reservation, dict):
                continue
            segments = []
            raw_segments = reservation.get("segments", [])
            if isinstance(raw_segments, list):
                for segment in raw_segments:
                    if not isinstance(segment, dict):
                        continue
                    lounges = []
                    raw_lounges = segment.get("lounges", [])
                    if isinstance(raw_lounges, list):
                        for lounge in raw_lounges:
                            if not isinstance(lounge, dict):
                                continue
                            lounges.append(
                                {
                                    "name": str(lounge.get("name") or "Airport lounge").strip(),
                                    "network": str(lounge.get("network") or "Other").strip(),
                                    "airport": str(lounge.get("airport") or segment.get("from") or "").strip().upper(),
                                    "terminal": str(lounge.get("terminal") or "Terminal pending").strip(),
                                    "access": str(lounge.get("access") or "verify").strip().lower(),
                                    "basis": str(lounge.get("basis") or "Eligibility must be verified").strip(),
                                    "hours": str(lounge.get("hours") or "Hours pending").strip(),
                                    "guests": str(lounge.get("guests") or "Guest policy pending").strip(),
                                    "verified_at": str(lounge.get("verified_at") or "").strip(),
                                    "source_url": str(lounge.get("source_url") or "").strip(),
                                    "evidence": lounge.get("evidence", []),
                                    "valid_until": lounge.get("valid_until", ""),
                                }
                            )
                    segments.append(
                        {
                            "flight_number": str(segment.get("flight_number") or "Flight pending").strip(),
                            "from": str(segment.get("from") or "").strip().upper(),
                            "to": str(segment.get("to") or "").strip().upper(),
                            "departure": str(segment.get("departure") or "").strip(),
                            "departure_label": str(segment.get("departure_label") or "Departure time pending").strip(),
                            "terminal": str(segment.get("terminal") or "Terminal pending").strip(),
                            "cabin": str(segment.get("cabin") or "Cabin pending").strip(),
                            "fare": str(segment.get("fare") or "Fare pending").strip(),
                            "lounges": lounges,
                        }
                    )
            normalized_reservations.append(
                {
                    "type": str(reservation.get("type") or "Travel").strip(),
                    "provider": str(reservation.get("provider") or "Not selected").strip(),
                    "confirmation": str(reservation.get("confirmation") or "").strip(),
                    "status": str(reservation.get("status") or "needed").strip().lower(),
                    "required": bool(reservation.get("required", True)),
                    "notes": str(reservation.get("notes") or "").strip(),
                    "segments": segments,
                    "verified_at": reservation.get("verified_at", ""),
                    "evidence": reservation.get("evidence", []),
                }
            )

        required = [reservation for reservation in normalized_reservations if reservation["required"]]
        verified = [reservation for reservation in required if reservation["status"] in CONFIRMED_STATES]
        missing = [reservation["type"] for reservation in required if reservation["status"] not in CONFIRMED_STATES]

        normalized_charges = []
        for charge in charges:
            if not isinstance(charge, dict):
                continue
            amount_known = charge.get("amount") is not None
            amount_label = str(charge.get("amount_label") or "").strip()
            redemption = bool(charge.get("redemption", False))
            try:
                amount = max(0.0, float(charge.get("amount") or 0))
            except (TypeError, ValueError):
                amount = 0.0
                amount_known = False
            normalized_charges.append(
                {
                    "merchant": str(charge.get("merchant") or "Travel charge").strip(),
                    "category": str(charge.get("category") or "Other").strip(),
                    "amount": round(amount, 2),
                    "currency": str(charge.get("currency") or "USD").strip().upper(),
                    "status": str(charge.get("status") or "expected").strip().lower(),
                    "timing": str(charge.get("timing") or "before trip").strip(),
                    "card": str(charge.get("card") or "Not recorded").strip(),
                    "amount_known": amount_known,
                    "amount_label": amount_label,
                    "redemption": redemption,
                    "miles": charge.get("miles"),
                    "cash_fees": charge.get("cash_fees"),
                    "reward_program": charge.get("reward_program", "SkyMiles"),
                    "verified_at": charge.get("verified_at", ""),
                    "evidence": charge.get("evidence", []),
                }
            )

        charged = sum(charge["amount"] for charge in normalized_charges if charge["status"] in PAID_STATES)
        later = sum(charge["amount"] for charge in normalized_charges if charge["status"] not in PAID_STATES)
        unknown_charged = sum(1 for charge in normalized_charges if not charge["amount_known"] and not charge["amount_label"] and charge["status"] in PAID_STATES)
        unknown_later = sum(1 for charge in normalized_charges if not charge["amount_known"] and not charge["amount_label"] and charge["status"] not in PAID_STATES)
        redemptions = sum(1 for charge in normalized_charges if charge["redemption"])
        recorded_cards = [charge["card"] for charge in normalized_charges if charge["amount_known"]]
        preferred_card = str(item.get("preferred_card") or "").strip()
        preferred_used = bool(preferred_card and recorded_cards) and all(
            card.casefold() == preferred_card.casefold() for card in recorded_cards
        )

        raw_expenses = item.get("business_expenses", {})
        if not isinstance(raw_expenses, dict):
            raw_expenses = {}
        expense_status = str(raw_expenses.get("submission_status") or ("not_applicable" if trip_type == "personal" else "no")).strip().lower()
        if expense_status not in {"yes", "no", "partial", "not_applicable"}:
            expense_status = "no" if trip_type == "business" else "not_applicable"
        try:
            reimbursed_amount = max(0.0, float(raw_expenses.get("reimbursed_amount") or 0))
        except (TypeError, ValueError):
            reimbursed_amount = 0.0
        try:
            remaining_amount = max(0.0, float(raw_expenses.get("remaining_amount") or 0))
        except (TypeError, ValueError):
            remaining_amount = 0.0

        return {
            "id": trip_id,
            "title": title,
            "trip_type": trip_type,
            "destination": str(item.get("destination") or title).strip(),
            "start_date": str(item.get("start_date") or "").strip(),
            "end_date": str(item.get("end_date") or "").strip(),
            "travelers": [str(value).strip() for value in item.get("travelers", []) if str(value).strip()]
            if isinstance(item.get("travelers", []), list)
            else [],
            "purpose": str(item.get("purpose") or "").strip(),
            "notes": str(item.get("notes") or "").strip(),
            "reservations": normalized_reservations,
            "charges": normalized_charges,
            "readiness": {
                "all_verified": bool(required) and len(verified) == len(required),
                "verified": len(verified),
                "required": len(required),
                "missing": missing,
            },
            "financials": {
                "charged": round(charged, 2),
                "later": round(later, 2),
                "total": round(charged + later, 2),
                "unknown_charges": unknown_charged + unknown_later,
                "unknown_charged": unknown_charged,
                "unknown_later": unknown_later,
                "redemptions": redemptions,
                "preferred_card_used": preferred_used,
            },
            "business_expenses": {
                "submission_status": expense_status,
                "reimbursed_amount": round(reimbursed_amount, 2),
                "remaining_amount": round(remaining_amount, 2),
                "currency": str(raw_expenses.get("currency") or "USD").strip().upper(),
                "notes": str(raw_expenses.get("notes") or "").strip(),
                "per_diem": raw_expenses.get("per_diem") if isinstance(raw_expenses.get("per_diem"), dict) else None,
            },
        }
