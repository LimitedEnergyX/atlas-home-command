"""Private, reviewed appointment snapshot. Never pretends to be live Google sync."""
import json
from datetime import datetime, timezone
from pathlib import Path


def read_calendar(path: Path) -> dict:
    if not path.exists():
        return {"status": "unavailable", "events": [], "detail": "No calendar snapshot has been imported."}
    try:
        if path.stat().st_size > 2_000_000:
            raise ValueError("Oversized calendar")
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        updated = datetime.fromisoformat(data["reviewed_at"].replace("Z", "+00:00"))
        if updated.tzinfo is None or data.get("schema_version") != 1 or not isinstance(data["events"], list):
            raise ValueError("Invalid calendar")
        events = []
        seen = set()
        for event in data["events"]:
            key = (event["calendar_id"], event["id"])
            if key in seen:
                continue
            seen.add(key)
            start = datetime.fromisoformat(event["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(event["end"].replace("Z", "+00:00"))
            if start.tzinfo is None or end.tzinfo is None or end <= start:
                raise ValueError("Invalid event time")
            fields = ("id", "calendar_id", "title", "start", "end", "location", "note", "category", "status", "url")
            clean = {field: str(event.get(field, ""))[:3000] for field in fields}
            if clean["category"] == "medical":
                clean["title"] = "Medical appointment"
                clean["note"] = "See the official appointment app for details."
                clean["location"] = "See the official appointment app"
            if not clean["url"].startswith("https://www.google.com/calendar/event?"):
                clean["url"] = ""
            events.append(clean)
        return {"status": "snapshot", "reviewed_at": data["reviewed_at"],
                "stale": (datetime.now(timezone.utc) - updated).total_seconds() > 86400,
                "coverage_start": data.get("coverage_start"), "coverage_end": data.get("coverage_end"),
                "source": "Reviewed calendar", "timezone": "America/Chicago",
                "detail": "Reviewed calendar snapshot. Refresh reloads the saved Atlas copy, not Google Calendar. Automatic sync is not configured.",
                "events": sorted(events, key=lambda e: e["start"])}
    except (ValueError, KeyError, TypeError, AttributeError, OSError):
        return {"status": "unavailable", "events": [], "detail": "Calendar snapshot could not be read. Check Google Calendar."}
