"""Local-only, revision-checked travel updates. No provider or purchase actions."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import re
import tempfile
from datetime import datetime, UTC, timedelta
from uuid import uuid4
from pathlib import Path


COLLECTIONS = {"trips": "id", "loyalty": "id", "sources": "provider", "cases": "id", "monitor": "id"}
FIELDS = {
    "trips": "id title trip_type destination start_date end_date travelers purpose notes reservations charges business_expenses departure_checks coverage evidence verified_at operator_review",
    "loyalty": "id program provider balance balance_label balance_unit balance_verified lounge_visits_remaining lounge_visits_verified_at status member_id_masked member_since qualification benefits verified_at notes evidence",
    "sources": "provider status bookings_found detail verified_at session_status session_checked_at evidence",
    "cases": "id trip_id title provider reference status owner next_action deadline deadline_kind notes amount currency verified_at evidence",
    "monitor": "id schedule timezone configuration_status configured_at last_check_at last_result next_check_at detail evidence",
}
FORBIDDEN = {"password", "token", "cookie", "cookies", "authorization", "card_number", "cvv", "secret", "api_key", "recovery_key"}


def timestamp(value, name="timestamp"):
    if not isinstance(value, str):
        raise ValueError(f"{name} must be an ISO timestamp with timezone")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
    except ValueError:
        raise ValueError(f"{name} must be an ISO timestamp with timezone") from None
    return parsed


def safe_values(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.casefold() in FORBIDDEN:
                raise ValueError("Credentials and card numbers are forbidden")
            safe_values(child)
    elif isinstance(value, list):
        for child in value:
            safe_values(child)
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Numbers must be finite")
    elif isinstance(value, str) and re.search(r"\b(?:\d[ -]?){15,19}\b|Bearer\s+\S+", value, re.I):
        raise ValueError("Possible credential or full card number; use a masked label")


def validate_record(collection, record):
    if not isinstance(record, dict) or set(record) - set(FIELDS[collection].split()):
        raise ValueError(f"Unknown fields in {collection} record")
    identity = record.get(COLLECTIONS[collection])
    if not isinstance(identity, str) or not identity.strip():
        raise ValueError("Record identity is required")
    safe_values(record)
    if "evidence" in record and (not isinstance(record["evidence"], list) or any(not isinstance(x, str) for x in record["evidence"])):
        raise ValueError("Evidence must be a list of reference strings")
    list_fields = {"travelers", "reservations", "charges", "departure_checks", "coverage", "evidence", "qualification", "benefits"}
    object_fields = {"business_expenses", "operator_review"}
    number_fields = {"balance", "lounge_visits_remaining", "bookings_found", "amount"}
    bool_fields = {"balance_verified"}
    for field, value in record.items():
        if field in list_fields:
            if not isinstance(value, list):
                raise ValueError(f"{field} must be a list")
        elif field in object_fields:
            if not isinstance(value, dict):
                raise ValueError(f"{field} must be an object")
        elif field in number_fields:
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0):
                raise ValueError(f"{field} must be a nonnegative number or null")
        elif field in bool_fields:
            if not isinstance(value, bool):
                raise ValueError(f"{field} must be a boolean")
        elif not isinstance(value, str):
            raise ValueError(f"{field} must be text")
    if collection == "trips":
        if record.get("trip_type", "unclassified") not in {"personal", "business", "unclassified"}:
            raise ValueError("Invalid trip_type")
        for field in ("start_date", "end_date"):
            if record.get(field):
                datetime.strptime(record[field], "%Y-%m-%d")
        if record.get("start_date") and record.get("end_date") and record["end_date"] < record["start_date"]:
            raise ValueError("Trip ends before it starts")
        for field in ("reservations", "charges", "departure_checks", "coverage"):
            if any(not isinstance(x, dict) for x in record.get(field, [])):
                raise ValueError(f"{field} entries must be objects")
        nested_fields = {
            "charges": "merchant category amount currency status timing card amount_label redemption miles cash_fees reward_program verified_at evidence",
            "reservations": "type provider confirmation status required notes segments verified_at evidence",
            "departure_checks": "label status verified_at valid_until evidence notes",
            "coverage": "name status scope effective_from effective_to verified_at evidence notes",
        }
        for field, allowed in nested_fields.items():
            for child in record.get(field, []):
                if set(child) - set(allowed.split()):
                    raise ValueError(f"Unknown {field} fields")
                if "evidence" in child and (not isinstance(child["evidence"], list) or any(not isinstance(x, str) for x in child["evidence"])):
                    raise ValueError("Evidence must contain strings")
        for charge in record.get("charges", []):
            for field in ("amount", "miles", "cash_fees"):
                value = charge.get(field)
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0):
                    raise ValueError(f"Charge {field} must be a nonnegative number or null")
            if charge.get("miles") is not None and charge["miles"] != int(charge["miles"]):
                raise ValueError("Miles must be whole numbers")
        for reservation in record.get("reservations", []):
            if reservation.get("status", "needed") not in {"needed", "confirmed", "reserved", "ticketed", "verified", "not-needed", "cancelled"}:
                raise ValueError("Invalid reservation status")
            if not isinstance(reservation.get("segments", []), list) or any(not isinstance(x, dict) for x in reservation.get("segments", [])):
                raise ValueError("Flight segments must be objects")
            if "required" in reservation and not isinstance(reservation["required"], bool):
                raise ValueError("Reservation required must be boolean")
            if reservation.get("status") == "not-needed" and reservation.get("required", True):
                raise ValueError("Not-needed reservations must have required=false")
        for check in record.get("departure_checks", []):
            if check.get("status") not in {"verified", "needed", "not-needed"} or not check.get("label"):
                raise ValueError("Departure checks need a label and valid status")
            if check["status"] == "verified":
                timestamp(check.get("verified_at"), "check verified_at")
                timestamp(check.get("valid_until"), "check valid_until")
                if not check.get("evidence"):
                    raise ValueError("Verified checks require evidence")
        for coverage in record.get("coverage", []):
            if coverage.get("status") not in {"verified", "unverified", "pending", "denied", "not-applicable"}:
                raise ValueError("Invalid coverage status")
            if coverage["status"] == "verified":
                timestamp(coverage.get("verified_at"), "coverage verified_at")
                if not all(coverage.get(k) for k in ("effective_from", "effective_to", "evidence", "scope")):
                    raise ValueError("Verified coverage needs dates, scope, and evidence")
                for key in ("effective_from", "effective_to"):
                    datetime.strptime(coverage[key], "%Y-%m-%d")
                if coverage["effective_from"] > coverage["effective_to"]:
                    raise ValueError("Invalid coverage date range")
    if collection == "cases":
        if record.get("status") not in {"open", "waiting", "closed"}:
            raise ValueError("Invalid case status")
        if not all(record.get(k) for k in ("owner", "next_action", "verified_at", "evidence")):
            raise ValueError("Cases need owner, next action, timestamp, and evidence")
        timestamp(record["verified_at"])
        if record.get("deadline"):
            datetime.strptime(record["deadline"], "%Y-%m-%d")
            if record.get("deadline_kind") not in {"confirmed", "diary", "follow-up"}:
                raise ValueError("Deadline must distinguish confirmed, diary, or follow-up")


class TravelStore:
    def __init__(self, path: Path):
        self.path = path

    def read(self):
        raw = self.path.read_bytes() if self.path.exists() else b"{}"
        data = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(data, dict):
            raise ValueError("Ledger must be an object")
        return data, hashlib.sha256(raw).hexdigest()

    def confirm_review(self, body):
        """Record household self-review only; never alter provider/coverage evidence."""
        from .targets.travel import TravelTarget
        from .targets.travel_evidence import trip_fingerprint
        if set(body) != {"trip_id", "revision", "confirmed", "checks", "profile"}:
            raise ValueError("Unexpected review fields")
        expected = {"bookings", "documents", "costs", "transport"}
        if body["confirmed"] is not True or not isinstance(body["checks"], list) or any(not isinstance(x, str) for x in body["checks"]) or set(body["checks"]) != expected:
            raise ValueError("Confirm every review item")
        if body["profile"] not in {"alex", "sam"}:
            raise ValueError("Choose a household profile")
        data, revision = self.read()
        if revision != body["revision"]:
            raise ValueError("Trip data changed. Refresh and review again.")
        previous = next((t for t in data.get("trips", []) if t.get("id") == body["trip_id"]), None)
        if previous is None:
            raise ValueError("Trip not found")
        if not TravelTarget._normalize_trip(previous, 0)["readiness"]["all_verified"]:
            raise ValueError("Complete required bookings first")
        now = datetime.now(UTC)
        until = datetime.strptime(previous.get("end_date", ""), "%Y-%m-%d").replace(tzinfo=UTC) + timedelta(days=1)
        if until <= now:
            raise ValueError("Past trips cannot be marked ready")
        value = copy.deepcopy(previous)
        value["operator_review"] = {"reviewed_by": body["profile"], "reviewed_at": now.isoformat(),
                                    "valid_until": until.isoformat(), "fingerprint": trip_fingerprint(previous),
                                    "checks": sorted(expected)}
        return self.update({"schema_version": 1, "base_revision": revision, "update_id": f"self-review-{uuid4()}",
                            "actor": f"Household Self-Review ({body['profile']})", "reason": "Travel Plan Reviewed",
                            "observed_at": now.isoformat(), "evidence": [f"Atlas household review: {body['trip_id']}"],
                            "uncertainty": "Household confirmation only; not provider verification or insurance approval.",
                            "operations": [{"collection": "trips", "id": body["trip_id"], "previous": previous, "value": value}]}, apply=True)

    def update(self, handoff, apply=False):
        if not isinstance(handoff, dict):
            raise ValueError("Handoff must be an object")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = self.path.with_suffix(".update.lock")
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise ValueError("Another update is active; stale locks require operator review") from None
        temporary = None
        try:
            os.close(fd)
            data, revision = self.read()
            if handoff.get("schema_version") != 1 or handoff.get("base_revision") != revision:
                raise ValueError("Schema or revision conflict; reread and rebase")
            if not all(isinstance(handoff.get(k), str) and handoff[k].strip() for k in ("update_id", "actor", "reason", "observed_at")):
                raise ValueError("Update ID, actor, reason, and observed_at are required")
            if any(x.get("update_id") == handoff["update_id"] for x in data.get("_audit", [])):
                raise ValueError("Update ID was already applied")
            observed = timestamp(handoff["observed_at"])
            if observed > datetime.now(UTC):
                raise ValueError("Observation cannot be in the future")
            evidence = handoff.get("evidence")
            if not isinstance(evidence, list) or not evidence or any(not isinstance(x, str) or not x.strip() for x in evidence):
                raise ValueError("Evidence references are required")
            if not isinstance(handoff.get("uncertainty"), str):
                raise ValueError("Explicit uncertainty text is required")
            operations = handoff.get("operations")
            if not isinstance(operations, list) or not 1 <= len(operations) <= 50:
                raise ValueError("Provide 1–50 record operations")
            safe_values(handoff)
            updated = copy.deepcopy(data)
            changes = []
            seen = set()
            for op in operations:
                if not isinstance(op, dict):
                    raise ValueError("Operations must be objects")
                collection, identity = op.get("collection"), op.get("id")
                if collection not in COLLECTIONS or not isinstance(identity, str):
                    raise ValueError("Unsupported collection or identity")
                if (collection, identity) in seen:
                    raise ValueError("Duplicate operation")
                seen.add((collection, identity))
                records = updated.setdefault(collection, [])
                if not isinstance(records, list) or any(not isinstance(r, dict) for r in records):
                    raise ValueError("Ledger collection must contain objects")
                key = COLLECTIONS[collection]
                matches = [r for r in records if r.get(key) == identity]
                if len(matches) > 1:
                    raise ValueError("Duplicate ledger identity")
                previous = matches[0] if matches else None
                if "previous" not in op or op["previous"] != previous:
                    raise ValueError("Previous record mismatch; no changes applied")
                value = op.get("value")
                validate_record(collection, value)
                if value[key] != identity:
                    raise ValueError("Identity cannot change")
                if previous is not None and set(previous) - set(value):
                    raise ValueError("Existing fields cannot be silently removed")
                if previous is not None:
                    records[records.index(previous)] = value
                else:
                    records.append(value)
                changes.append({"collection": collection, "id": identity, "previous": previous, "value": value})
            updated["version"] = 3
            updated.setdefault("_audit", []).append({
                **{k: handoff[k] for k in ("update_id", "actor", "reason", "observed_at", "evidence", "uncertainty")},
                "applied_at": datetime.now(UTC).isoformat(), "base_revision": revision, "changes": changes,
            })
            encoded = (json.dumps(updated, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
            # Exercise the actual consumer before persisting anything.
            from .targets.travel import TravelTarget
            TravelTarget.normalize_payload(updated)
            if apply:
                with tempfile.NamedTemporaryFile(dir=self.path.parent, prefix="travel-", suffix=".tmp", delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(encoded)
                    stream.flush()
                    os.fsync(stream.fileno())
                if self.read()[1] != revision:
                    raise ValueError("Ledger changed during update")
                os.replace(temporary, self.path)
                temporary = None
                _, after = self.read()
                if after != hashlib.sha256(encoded).hexdigest():
                    raise RuntimeError("Read-back mismatch; inspect ledger before retrying")
            else:
                after = revision
            return {"status": "applied-and-verified" if apply else "validated-preview", "revision": after,
                    "update_id": handoff["update_id"], "changes": changes}
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
            lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=Path("data") / "travel.json")
    parser.add_argument("--handoff", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    store = TravelStore(args.ledger)
    try:
        if args.handoff:
            result = store.update(json.loads(args.handoff.read_text(encoding="utf-8-sig")), apply=args.apply)
        else:
            if args.apply:
                raise ValueError("--apply requires --handoff")
            data, revision = store.read()
            result = {"schema_version": 1, "revision": revision, "data": data}
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Travel update rejected: {exc}\n")


if __name__ == "__main__":
    main()
