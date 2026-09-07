"""Tesla calendar datasets and user evidence, deliberately separate from billing estimates."""
from __future__ import annotations

import json
import math
import sqlite3
import statistics
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("America/Chicago")
TRANSFERS = {
    "solar_to_home": "consumer_energy_imported_from_solar",
    "solar_to_battery": "battery_energy_imported_from_solar",
    "solar_to_grid": "grid_energy_exported_from_solar",
    "battery_to_home": "consumer_energy_imported_from_battery",
    "battery_to_grid": "grid_energy_exported_from_battery",
    "grid_to_home": "consumer_energy_imported_from_grid",
    "grid_to_battery": "battery_energy_imported_from_grid",
    "generator_to_home": "consumer_energy_imported_from_generator",
    "generator_to_battery": "battery_energy_imported_from_generator",
    "generator_to_grid": "grid_energy_exported_from_generator",
}


def number(value: Any) -> float | None:
    return float(value) if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) else None


def total(values: list[float | None]) -> float | None:
    return round(sum(values), 6) if values and all(v is not None for v in values) else None


def calendar_bounds(period: str, date_text: str, now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or datetime.now(ZONE)
    day = date.fromisoformat(date_text or now.astimezone(ZONE).date().isoformat())
    if day.year < 2010 or day > now.astimezone(ZONE).date():
        raise ValueError("Choose a date from 2010 through today")
    if period == "day":
        next_day = day + timedelta(days=1)
    elif period == "month":
        day = day.replace(day=1)
        next_day = date(day.year + (day.month == 12), day.month % 12 + 1, 1)
    elif period == "year":
        day = day.replace(month=1, day=1)
        next_day = date(day.year + 1, 1, 1)
    else:
        raise ValueError("period must be day, month, or year")
    return datetime.combine(day, datetime.min.time(), ZONE), datetime.combine(next_day, datetime.min.time(), ZONE)


def normalize_row(row: dict) -> dict:
    values = {key: None if number(row.get(field)) is None else number(row[field]) / 1000 for key, field in TRANSFERS.items()}
    def kwh(field: str) -> float | None:
        value = number(row.get(field))
        return value / 1000 if value is not None else None
    values.update(
        solar_kwh=kwh("solar_energy_exported"),
        home_kwh=total([values[k] for k in ("solar_to_home", "battery_to_home", "grid_to_home", "generator_to_home")]),
        battery_discharge_kwh=kwh("battery_energy_exported"),
        battery_charge_kwh=total([values[k] for k in ("solar_to_battery", "grid_to_battery", "generator_to_battery")]),
        grid_import_kwh=kwh("grid_energy_imported"),
        grid_export_kwh=total([values[k] for k in ("solar_to_grid", "battery_to_grid", "generator_to_grid")]),
    )
    return values


class EnergyStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS datasets (
                    kind TEXT NOT NULL, period TEXT NOT NULL, start_date TEXT NOT NULL,
                    fetched_at TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(kind, period, start_date));
                CREATE TABLE IF NOT EXISTS reference_snapshots (
                    id TEXT PRIMARY KEY, period TEXT NOT NULL, anchor TEXT,
                    imported_at TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS reference_period ON reference_snapshots(period, anchor);
                CREATE TABLE IF NOT EXISTS context_notes (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            """)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def import_reference(self, payload: dict) -> None:
        if not payload.get("id") or payload.get("period") not in {"day", "month", "year"}:
            raise ValueError("Reference needs an id and calendar period")
        with self.connect() as db:
            # Idempotent import, never modifies or replaces an earlier observation.
            db.execute("INSERT OR IGNORE INTO reference_snapshots VALUES (?, ?, ?, ?, ?)",
                       (payload["id"], payload["period"], payload.get("anchor"), datetime.now(UTC).isoformat(), json.dumps(payload, allow_nan=False)))

    def import_context(self, note: dict) -> None:
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO context_notes VALUES (?, ?)", (note["id"], json.dumps(note, allow_nan=False)))

    def references(self, period: str, start: datetime) -> list:
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute(
                "SELECT payload FROM reference_snapshots WHERE period=? AND anchor=? ORDER BY imported_at DESC",
                (period, start.date().isoformat()))]

    def dataset(self, reader: Callable, kind: str, period: str, start: datetime, end: datetime) -> dict:
        key = (kind, period, start.isoformat())
        with self.connect() as db:
            saved = db.execute("SELECT payload FROM datasets WHERE kind=? AND period=? AND start_date=?", key).fetchone()
        previous = json.loads(saved[0]) if saved else None
        # Recent data refreshes every five minutes. Completed periods revalidate daily.
        ttl = 300 if end > datetime.now(ZONE) else 86400
        if previous and (datetime.now(UTC) - datetime.fromisoformat(previous["fetched_at"].replace("Z", "+00:00"))).total_seconds() < ttl:
            return previous
        try:
            payload = reader(kind, period, start.isoformat(), (end - timedelta(seconds=1)).isoformat())
            if payload.get("source") != "tesla-fleet-api" or not isinstance(payload.get("time_series"), list):
                raise ValueError("Invalid Tesla dataset")
            with self.connect() as db:
                db.execute("INSERT INTO datasets VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind,period,start_date) DO UPDATE SET fetched_at=excluded.fetched_at,payload=excluded.payload",
                           (*key, payload["fetched_at"], json.dumps(payload, allow_nan=False)))
            return payload
        except Exception:
            if previous:
                return {**previous, "stale": True}
            return {"time_series": [], "unavailable": True}

    def calendar(self, reader: Callable, period: str, date_text: str) -> dict:
        start, end = calendar_bounds(period, date_text)
        # Serialize page loads; source adapter also coalesces concurrent Tesla requests.
        with self.lock:
            kinds = ["energy", "power", "soe"] if period == "day" else ["energy"]
            with ThreadPoolExecutor(max_workers=3) as pool:
                payloads = dict(zip(kinds, pool.map(lambda kind: self.dataset(reader, kind, period, start, end), kinds)))
        energy = payloads["energy"]
        now = datetime.now(ZONE)
        # A cached, unfinished interval does not become complete just because time passes.
        measured_at = min(now, datetime.fromisoformat(energy.get("fetched_at", now.isoformat()).replace("Z", "+00:00")))
        rows = {}
        for raw in energy["time_series"]:
            try:
                at = datetime.fromisoformat(raw["timestamp"].replace("Z", "+00:00"))
                if at.tzinfo is None or not start <= at < min(end, now):
                    continue
                rows[at.astimezone(UTC)] = {"at": at.astimezone(ZONE).isoformat(), "values": normalize_row(raw)}
            except (KeyError, ValueError, TypeError):
                continue
        times = sorted(rows)
        diffs = [(b - a).total_seconds() for a, b in zip(times, times[1:])]
        seconds = statistics.median(diffs) if diffs else None
        # Keep the resolution of each source query separate. Never sum overlapping datasets.
        buckets: dict[str, dict] = {}
        for at in times:
            item = rows[at]
            local = at.astimezone(ZONE)
            key = local.strftime("%Y-%m") if period == "year" else local.strftime("%Y-%m-%d") if period == "month" else item["at"]
            bucket = buckets.setdefault(key, {"at": item["at"], "key": key, "rows": []})
            bucket["rows"].append(item["values"])
        fields = list(normalize_row({}))
        totals = {field: total([rows[at]["values"][field] for at in times]) for field in fields}
        output_buckets = []
        for bucket in buckets.values():
            values = {field: total([row[field] for row in bucket["rows"]]) for field in fields}
            at = datetime.fromisoformat(bucket["at"])
            partial = False
            if seconds:
                if period == "day":
                    partial = at.astimezone(UTC) + timedelta(seconds=seconds) > measured_at.astimezone(UTC)
                else:
                    group_period = "month" if period == "year" else "day"
                    group_start, group_end = calendar_bounds(group_period, at.date().isoformat())
                    expected = (group_end.astimezone(UTC) - group_start.astimezone(UTC)).total_seconds() / seconds
                    partial = len(bucket["rows"]) < expected
            output_buckets.append({"at": bucket["at"], "key": bucket["key"], "values": values, "partial": partial})
        chart_gaps = False
        if period == "year" and times:
            # Year queries use two-hour UTC-aligned intervals that can cross local
            # midnight after DST. Never assign those whole intervals to a month.
            # Read each month's calendar dataset for correctly bounded monthly bars.
            first_month = times[0].astimezone(ZONE).date().replace(day=1)
            month_bounds = [calendar_bounds("month", f"{start.year}-{month:02d}-01")
                            for month in range(1, 13) if first_month <= date(start.year, month, 1) <= now.date()]
            with self.lock, ThreadPoolExecutor(max_workers=3) as pool:
                month_data = list(pool.map(lambda bounds: self.dataset(reader, "energy", "month", *bounds), month_bounds))
            output_buckets = []
            for (month_start, month_end), payload in zip(month_bounds, month_data):
                month_rows = {}
                for raw in payload["time_series"]:
                    try:
                        at = datetime.fromisoformat(raw["timestamp"].replace("Z", "+00:00"))
                        if month_start <= at < min(month_end, now):
                            month_rows[at.astimezone(UTC)] = normalize_row(raw)
                    except (ValueError, TypeError, KeyError):
                        continue
                if not month_rows:
                    if month_end > times[0]:
                        chart_gaps = True
                    continue
                timestamps = sorted(month_rows)
                gaps = [(b - a).total_seconds() for a, b in zip(timestamps, timestamps[1:])]
                cadence = statistics.median(gaps) if gaps else None
                expected = (month_end.astimezone(UTC) - month_start.astimezone(UTC)).total_seconds() / cadence if cadence else None
                output_buckets.append({
                    "at": month_start.isoformat(), "key": month_start.strftime("%Y-%m"),
                    "values": {field: total([month_rows[t][field] for t in timestamps]) for field in fields},
                    "partial": expected is None or len(timestamps) < expected,
                    "stale": bool(payload.get("stale")), "source": "tesla-month-calendar",
                })
                chart_gaps = chart_gaps or bool(cadence and any(gap > cadence * 1.5 for gap in gaps))
        references = self.references(period, start)
        with self.connect() as db:
            notes = [json.loads(row[0]) for row in db.execute("SELECT payload FROM context_notes ORDER BY id")]
            coverage = db.execute("SELECT payload FROM datasets WHERE kind='energy' AND period='year' ORDER BY start_date").fetchall()
        known_first = []
        for (stored,) in coverage:
            known_first.extend(row["timestamp"] for row in json.loads(stored)["time_series"] if row.get("timestamp"))
        def samples(kind: str, names: dict) -> list:
            result = []
            for row in payloads.get(kind, {}).get("time_series", []):
                try:
                    at = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                    if not start <= at < min(end, now):
                        continue
                    result.append({"at": at.astimezone(ZONE).isoformat(), **{key: number(row.get(field)) for key, field in names.items()}})
                except (ValueError, KeyError, TypeError):
                    continue
            return result
        return {
            "status": "cached" if energy.get("stale") else "healthy" if times else "reference" if references else "unavailable",
            "source": "tesla-fleet-api" if times else "tesla-app-screenshot" if references else None,
            "period": period, "date": start.date().isoformat(), "time_zone": str(ZONE),
            "start": start.isoformat(), "end": end.isoformat(), "fetched_at": energy.get("fetched_at"),
            "in_progress": end > measured_at, "totals": totals, "buckets": output_buckets,
            "interval_seconds": seconds, "interval_count": len(times),
            "coverage_start": rows[times[0]]["at"] if times else None,
            "coverage_end": rows[times[-1]]["at"] if times else None,
            "history_start": min(known_first) if known_first else None,
            "has_gaps": chart_gaps or bool(seconds and any(diff > seconds * 1.5 for diff in diffs)),
            "chart_source": "tesla-month-calendar" if period == "year" else "tesla-energy-calendar",
            "power": samples("power", {"solar_w": "solar_power", "battery_w": "battery_power", "grid_w": "grid_power"}),
            "charge_level": samples("soe", {"percent": "soe"}),
            "charge_level_stale": bool(payloads.get("soe", {}).get("stale")),
            "references": references, "context": notes,
        }
