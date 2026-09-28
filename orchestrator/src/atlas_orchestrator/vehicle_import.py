"""Explicit local, insert-only vehicle import. No network or device access."""
import argparse
import json
from pathlib import Path
from .asset_store import AssetStore, TENANT_ZERO


def validate(data):
    if not isinstance(data, dict) or data.get("schema_version") != 1 or not isinstance(data.get("assets"), list):
        raise ValueError("Expected schema_version 1 and assets list")
    if not 1 <= len(data["assets"]) <= 3:
        raise ValueError("Supply one to three vehicle profiles")
    seen, result = set(), []
    for item in data["assets"]:
        if not isinstance(item, dict):
            raise ValueError("Invalid vehicle")
        ident = item.get("id")
        if ident not in {"vehicle-athena", "vehicle-big-red", "vehicle-harley"} or ident in seen:
            raise ValueError("Invalid or duplicate vehicle slot")
        seen.add(ident)
        clean = {"id": ident}
        for key in ("name", "manufacturer", "model", "summary", "source"):
            value = item.get(key, "")
            if not isinstance(value, str) or len(value) > 2000:
                raise ValueError("Invalid vehicle text")
            clean[key] = value
        if not clean["name"].strip() or not clean["source"].strip():
            raise ValueError("Name and source are required")
        year = item.get("model_year")
        if year is not None and (type(year) is not int or not 1900 <= year <= 2100):
            raise ValueError("Invalid model year")
        clean["model_year"] = year
        color = item.get("color", "")
        miles = item.get("odometer_miles")
        if not isinstance(color, str) or len(color) > 100 or (miles is not None and (type(miles) is not int or not 0 <= miles <= 10_000_000)):
            raise ValueError("Invalid color or odometer")
        clean["details"] = {"color": color, "odometer": {"miles": miles, "approximate": True}}
        events = item.get("events", [])
        if not isinstance(events, list) or len(events) > 200:
            raise ValueError("Invalid service history")
        clean["events"] = []
        from datetime import date
        for event in events:
            if not isinstance(event, dict):
                raise ValueError("Invalid service event")
            row = {field: event.get(field, "") for field in ("event_date", "title", "detail", "state")}
            if any(not isinstance(value, str) or len(value) > 4000 for value in row.values()):
                raise ValueError("Invalid service text")
            date.fromisoformat(row["event_date"])
            if not row["title"] or row["state"] not in {"complete", "planned", "canceled"}:
                raise ValueError("Service event needs title and state")
            clean["events"].append(row)
        result.append(clean)
    return result


def insert(store, assets):
    with store.connect() as db:
        for item in assets:
            if db.execute("SELECT 1 FROM assets WHERE id = ?", (item["id"],)).fetchone():
                raise ValueError("Vehicle already exists; import refuses to overwrite it")
        now = store._now()
        for item in assets:
            db.execute("""INSERT INTO assets (id,tenant_id,kind,name,status,manufacturer,model,model_year,
                summary,source,details_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (item["id"], TENANT_ZERO, "vehicle", item["name"], "active", item["manufacturer"], item["model"],
                 item["model_year"], item["summary"], item["source"], json.dumps(item["details"]), now, now))
            for event in item["events"]:
                db.execute("""INSERT INTO asset_events (tenant_id,asset_id,event_date,category,title,detail,state,mandatory)
                    VALUES (?,?,?,?,?,?,?,0)""", (TENANT_ZERO,item["id"],event["event_date"],"service",event["title"],event["detail"],event["state"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true", help="Insert validated records; default only validates")
    args = parser.parse_args()
    if args.file.stat().st_size > 1_000_000:
        parser.error("File is too large")
    try:
        assets = validate(json.loads(args.file.read_text(encoding="utf-8-sig")))
        if args.apply:
            insert(AssetStore(args.data_dir / "assets.sqlite3"), assets)
        print(f"{len(assets)} vehicle profiles {'inserted' if args.apply else 'validated; no records changed'}.")
    except (ValueError, TypeError, KeyError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
