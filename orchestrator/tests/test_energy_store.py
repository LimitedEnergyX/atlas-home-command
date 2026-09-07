from __future__ import annotations
import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from atlas_orchestrator.energy_store import EnergyStore, TRANSFERS, calendar_bounds, normalize_row, total


class EnergyStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = EnergyStore(Path(self.temp.name) / "energy.sqlite3")
        self.calls = []

    def reader(self, kind, period, start, end):
        self.calls.append((kind, period, start))
        row = {field: 0 for field in TRANSFERS.values()}
        row.update(timestamp=start, solar_energy_exported=1000,
                   consumer_energy_imported_from_solar=600,
                   battery_energy_imported_from_solar=300,
                   grid_energy_exported_from_solar=100,
                   grid_energy_imported=20, consumer_energy_imported_from_grid=20,
                   battery_energy_exported=50, consumer_energy_imported_from_battery=50)
        later = datetime.fromisoformat(start) + timedelta(minutes=5)
        return {"source": "tesla-fleet-api", "fetched_at": datetime.now(UTC).isoformat(), "time_series": [row, {**row, "timestamp": later.isoformat()}] if kind == "energy" else []}

    def test_units_and_source_destinations(self):
        result = self.store.calendar(self.reader, "day", "2025-09-05")
        self.assertEqual(result["totals"]["solar_kwh"], 2)
        self.assertEqual(result["totals"]["home_kwh"], 1.34)
        self.assertEqual(result["totals"]["battery_charge_kwh"], .6)
        self.assertEqual(result["totals"]["grid_export_kwh"], .2)
        self.assertEqual(result["interval_seconds"], 300)
        self.assertEqual(result["status"], "healthy")

    def test_dst_calendar_bounds(self):
        for day, hours in [("2026-03-08", 23), ("2025-11-02", 25)]:
            start, end = calendar_bounds("day", day)
            self.assertEqual((end.astimezone(UTC) - start.astimezone(UTC)).total_seconds(), hours * 3600)

    def test_invalid_and_future_dates(self):
        for period, day in [("week", "2025-09-01"), ("year", "2039-01-01"), ("day", "2025-02-30"), ("day", "2009-12-31")]:
            with self.assertRaises(ValueError):
                calendar_bounds(period, day)

    def test_missing_is_not_zero(self):
        self.assertIsNone(normalize_row({})["solar_kwh"])
        self.assertIsNone(total([2, None]))
        self.assertIsNone(total([]))
        self.assertEqual(total([0, 0]), 0)
        self.assertIsNone(normalize_row({"solar_energy_exported": float("nan")})["solar_kwh"])

    def test_queries_do_not_double_count_and_cache_is_durable(self):
        first = self.store.calendar(self.reader, "day", "2025-09-05")
        self.store.calendar(self.reader, "month", "2025-09-05")
        calls = len(self.calls)
        next_store = EnergyStore(self.store.path)
        again = next_store.calendar(self.reader, "day", "2025-09-05")
        self.assertEqual(len(self.calls), calls)
        self.assertEqual(first["totals"], again["totals"])
        with next_store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM datasets").fetchone()[0], 4)

    def test_month_and_year_buckets_no_future_zeroes(self):
        for period, key in [("month", "2025-09-01"), ("year", "2025-01")]:
            result = self.store.calendar(self.reader, period, "2025-09-05")
            self.assertEqual(len(result["buckets"]), 12 if period == "year" else 1)
            self.assertEqual(result["buckets"][0]["key"], key)
            self.assertTrue(result["buckets"][0]["partial"])

    def test_duplicate_timestamps_and_out_of_range_rows(self):
        def reader(*args):
            result = self.reader(*args)
            result["time_series"] += result["time_series"][:1]
            result["time_series"].append({"timestamp": "2025-01-01T00:00:00-06:00", "solar_energy_exported": 999999})
            return result
        result = self.store.calendar(reader, "day", "2025-09-05")
        self.assertEqual(result["totals"]["solar_kwh"], 2)
        self.assertEqual(result["interval_count"], 2)

    def test_unavailable_and_reference_not_mixed_into_actual(self):
        def unavailable(*args):
            raise OSError("Offline")
        reference = {"id": "test", "period": "year", "anchor": "2025-01-01", "values": {"solar_kwh": 7777}}
        self.store.import_reference(reference)
        self.store.import_reference(reference)
        result = self.store.calendar(unavailable, "year", "2025-09-05")
        self.assertEqual(result["status"], "reference")
        self.assertEqual(len(result["references"]), 1)
        result = self.store.calendar(self.reader, "year", "2025-09-05")
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["totals"]["solar_kwh"], 2)

    def test_stale_fallback_retains_provenance(self):
        self.store.calendar(self.reader, "year", "2025-09-05")
        with self.store.connect() as db:
            row = db.execute("SELECT payload FROM datasets").fetchone()
            payload = json.loads(row[0]); payload["fetched_at"] = "2025-12-31T23:00:00+00:00"
            db.execute("UPDATE datasets SET payload=?", (json.dumps(payload),))
        def offline(*args):
            raise OSError("Offline")
        result = self.store.calendar(offline, "year", "2025-09-05")
        self.assertEqual(result["status"], "cached")
        self.assertEqual(result["source"], "tesla-fleet-api")

    def test_year_month_bars_use_calendar_aligned_month_reads(self):
        def reader(kind, period, start, end):
            output = self.reader(kind, period, start, end)
            row = output["time_series"][0]
            output["time_series"] = []
            if period == "year":
                output["time_series"] = [{**row, "timestamp": "2025-08-31T23:00:00-05:00"}]
            elif start.startswith("2025-08") or start.startswith("2025-09"):
                output["time_series"] = [{**row, "solar_energy_exported": 500}]
            return output
        result = self.store.calendar(reader, "year", "2025-12-31")
        self.assertEqual(result["totals"]["solar_kwh"], 1)
        self.assertEqual([bucket["values"]["solar_kwh"] for bucket in result["buckets"]], [.5, .5])
        self.assertEqual([bucket["key"] for bucket in result["buckets"]], ["2025-08", "2025-09"])

if __name__ == "__main__":
    unittest.main()
