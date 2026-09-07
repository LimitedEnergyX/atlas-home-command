"""Household service records. Dates are entered, never inferred from telemetry."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4


class MaintenanceStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS maintenance (
                id TEXT PRIMARY KEY, equipment TEXT NOT NULL, task TEXT NOT NULL,
                due_date TEXT NOT NULL, notes TEXT NOT NULL,
                created_at TEXT NOT NULL, completed_at TEXT)""")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def text(value, name, limit, required=True):
        if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
            raise ValueError(f"{name} must be text between {1 if required else 0} and {limit} characters")
        return value.strip()

    def add(self, body):
        equipment = self.text(body.get("equipment"), "Equipment", 100)
        task = self.text(body.get("task"), "Task", 160)
        due = self.text(body.get("due_date"), "Due date", 10)
        if date.fromisoformat(due).isoformat() != due:
            raise ValueError("Due date must be YYYY-MM-DD")
        notes = self.text(body.get("notes", ""), "Notes", 1500, False)
        identifier = str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            db.execute("INSERT INTO maintenance VALUES (?, ?, ?, ?, ?, ?, NULL)",
                       (identifier, equipment, task, due, notes, now))
        return {"status": "saved", "id": identifier}

    def complete(self, identifier):
        identifier = self.text(identifier, "Record ID", 36)
        with self.connect() as db:
            result = db.execute("UPDATE maintenance SET completed_at=COALESCE(completed_at, ?) WHERE id=?",
                                (datetime.now(timezone.utc).isoformat(), identifier))
            if result.rowcount != 1:
                raise ValueError("Maintenance record not found")
        return {"status": "completed", "id": identifier}

    def status(self, today=None):
        today = today or date.today()
        soon = today + timedelta(days=30)
        with self.connect() as db:
            rows = [dict(row) for row in db.execute("SELECT * FROM maintenance ORDER BY due_date, created_at")]
        for row in rows:
            row["state"] = ("completed" if row["completed_at"] else "overdue" if row["due_date"] < today.isoformat()
                            else "due_soon" if row["due_date"] <= soon.isoformat() else "scheduled")
        return {"status": "healthy", "as_of": today.isoformat(), "records": rows,
                "summary": {key: sum(row["state"] == key for row in rows)
                            for key in ("overdue", "due_soon", "scheduled", "completed")}}
