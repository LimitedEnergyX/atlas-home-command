import tempfile
import unittest
from datetime import date
from pathlib import Path
from atlas_orchestrator.maintenance import MaintenanceStore


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.store=MaintenanceStore(Path(self.temp.name)/"maintenance.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def test_dates_are_explicit_and_completion_is_idempotent(self):
        self.assertEqual(self.store.status()["records"],[])
        for due in ["2026-01-01","2026-01-02","2026-02-15"]:
            self.store.add({"equipment":"Air handler","task":"Inspect filter","due_date":due})
        result=self.store.status(date(2026,1,2))
        self.assertEqual(result["summary"],{"overdue":1,"due_soon":1,"scheduled":1,"completed":0})
        identifier=result["records"][0]["id"]
        self.store.complete(identifier)
        completed=self.store.status()["records"][0]["completed_at"]
        self.store.complete(identifier)
        self.assertEqual(self.store.status()["records"][0]["completed_at"],completed)
        reloaded=MaintenanceStore(self.store.path)
        self.assertEqual(len(reloaded.status()["records"]),3)

    def test_invalid_input_rejected_and_text_not_executed(self):
        valid={"equipment":"Air handler","task":"Check filter","due_date":"2026-01-01"}
        for field,value in [("equipment",""),("task","x"*161),("due_date","2026-02-30"),("notes",123)]:
            with self.assertRaises(ValueError):self.store.add({**valid,field:value})
        with self.assertRaises(ValueError):self.store.complete("missing")
        self.store.add({**valid,"notes":"'); DROP TABLE maintenance; --"})
        self.assertEqual(len(self.store.status()["records"]),1)
