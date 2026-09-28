"""Read reviewed references, not estimated charging sessions or live attribution."""
import json
import math
from datetime import date
from pathlib import Path


def read_charging_records(path: Path) -> dict:
    if not path.exists():
        return {"status": "not_imported", "records": []}
    try:
        if path.stat().st_size > 1_000_000:
            raise ValueError("Oversized references")
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        if data.get("schema_version") != 1 or not isinstance(data.get("records"), list) or len(data["records"]) > 1000:
            raise ValueError("Invalid references")
        records, seen = [], set()
        for item in data["records"]:
            ident = item["id"]
            if not isinstance(ident, str) or not ident.strip() or len(ident) > 120 or ident in seen:
                raise ValueError("Duplicate or invalid reference ID")
            seen.add(ident)
            day = date.fromisoformat(item["date"]).isoformat()
            if item["source"] not in {"Home", "Supercharger", "Other"}:
                raise ValueError("Invalid source")
            clean = {"id": ident, "date": day, "source": item["source"], "detail": str(item.get("detail", "Reviewed reference"))[:1000]}
            for field in ("kwh", "solar", "battery", "grid", "rated_miles"):
                value = item.get(field)
                if value is None and field != "kwh":
                    continue
                if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                    raise ValueError("Invalid quantity")
                clean[field] = value
            split = sum(clean.get(f, 0) for f in ("solar", "battery", "grid"))
            if split > clean["kwh"] + 0.01:
                raise ValueError("Split exceeds total")
            records.append(clean)
        return {"status": "reviewed_references", "records": sorted(records, key=lambda r: (r["date"], r["id"]))}
    except (ValueError, TypeError, KeyError, AttributeError, OSError):
        return {"status": "invalid", "records": []}
