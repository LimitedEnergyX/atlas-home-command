"""Evidence-derived travel presentation; never infer coverage from a card name."""
from datetime import datetime, UTC
import hashlib
import json


def trip_fingerprint(raw):
    fields = ("start_date", "end_date", "travelers", "reservations", "charges", "coverage", "departure_checks")
    return hashlib.sha256(json.dumps({k: raw.get(k) for k in fields}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def current_check(check):
    try:
        verified = datetime.fromisoformat(check.get("verified_at", "").replace("Z", "+00:00"))
        expires = datetime.fromisoformat(check.get("valid_until", "").replace("Z", "+00:00"))
        return (check.get("status") == "verified" and bool(check.get("evidence"))
                and verified.tzinfo is not None and expires.tzinfo is not None
                and verified <= datetime.now(UTC) <= expires)
    except (ValueError, TypeError):
        return False


def enrich_trip(trip, raw):
    checks = [dict(x, current=current_check(x)) for x in raw.get("departure_checks", [])]
    required = [x for x in checks if x.get("status") != "not-needed"]
    ready = bool(required) and all(x["current"] for x in required) and trip["readiness"]["all_verified"]
    trip["departure"] = {"ready": ready, "checks": checks,
                         "label": "Departure Ready" if ready else "Departure Review Needed"}
    review = raw.get("operator_review") or {}
    try:
        reviewed = (review.get("fingerprint") == trip_fingerprint(raw)
                    and datetime.fromisoformat(review["reviewed_at"]) <= datetime.now(UTC)
                    <= datetime.fromisoformat(review["valid_until"]))
    except (KeyError, ValueError, TypeError):
        reviewed = False
    trip["operator_review"] = dict(review, current=bool(reviewed))
    trip["departure"]["good_to_go"] = bool(trip["readiness"]["all_verified"] and (ready or reviewed))
    trip["coverage"] = raw.get("coverage", [])
    trip["evidence"] = raw.get("evidence", [])
    trip["verified_at"] = raw.get("verified_at", "")
    # Financial totals are kept separate by currency; rewards never become cash.
    paid, later, miles = {}, {}, {}
    unknown_paid = unknown_later = unknown_miles = 0
    for charge in trip["charges"]:
        is_paid = charge["status"] in {"paid", "charged"}
        currency = charge["currency"]
        amount = charge["amount"] if charge["amount_known"] else None
        if charge["redemption"]:
            amount = charge.get("cash_fees")
            if charge.get("miles") is None:
                unknown_miles += 1
            else:
                program = charge.get("reward_program") or "Miles"
                miles[program] = miles.get(program, 0) + charge["miles"]
        if amount is None:
            unknown_paid += int(is_paid)
            unknown_later += int(not is_paid)
        else:
            bucket = paid if is_paid else later
            bucket[currency] = round(bucket.get(currency, 0) + amount, 2)
    trip["costs"] = {"paid": paid, "later": later, "miles": miles,
                     "unknown_paid": unknown_paid, "unknown_later": unknown_later, "unknown_miles": unknown_miles}
    return trip


def attention(trips, cases):
    items = []
    for case in cases:
        if case.get("status") != "closed":
            items.append({"title": case.get("title", "Open Case"), "detail": case.get("next_action", "Review Case"),
                          "owner": case.get("owner", "Unassigned"), "deadline": case.get("deadline", ""),
                          "deadline_kind": case.get("deadline_kind", ""), "case_id": case["id"],
                          "verified_at": case.get("verified_at", ""), "evidence": case.get("evidence", [])})
    for trip in trips:
        reasons = []
        if not trip["readiness"]["all_verified"]:
            reasons.append("Complete Required Bookings")
        if not trip["departure"]["good_to_go"]:
            reasons.append("Review Departure Checklist")
        if trip["costs"]["unknown_paid"] or trip["costs"]["unknown_later"] or trip["costs"]["unknown_miles"]:
            reasons.append("Verify Miles And Cash Costs")
        if not trip["coverage"]:
            reasons.append("Verify Trip Coverage")
        if reasons:
            items.append({"title": trip["title"], "detail": " · ".join(reasons), "trip_id": trip["id"],
                          "owner": "Travel Agent / Alex", "deadline": "", "deadline_kind": "",
                          "verified_at": trip.get("verified_at", ""), "evidence": trip.get("evidence", [])})
    return sorted(items, key=lambda x: x.get("deadline") or "9999-12-31")
