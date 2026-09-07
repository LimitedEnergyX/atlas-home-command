from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .redaction import Redactor
from .schemas import utc_now


class Ledger:
    def __init__(self, path: Path, redactor: Redactor) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.redactor = redactor
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                )"""
            )
            connection.execute(
                """CREATE TABLE IF NOT EXISTS idempotency (
                    idempotency_key TEXT PRIMARY KEY,
                    action_id TEXT NOT NULL,
                    claimed_at TEXT NOT NULL
                )"""
            )

    def health(self) -> bool:
        with self._connect() as connection:
            return connection.execute("PRAGMA quick_check").fetchone()[0] == "ok"

    def append(self, event_type: str, entity_id: str, payload: dict[str, Any]) -> int:
        safe = self.redactor.redact(payload)
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO events(created_at,event_type,entity_id,payload_json) VALUES(?,?,?,?)",
                (utc_now(), event_type, entity_id, json.dumps(safe, sort_keys=True)),
            )
            return int(cursor.lastrowid)

    def events(self, entity_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM events WHERE entity_id=? ORDER BY sequence", (entity_id,)
            ).fetchall()
        return [
            {
                "sequence": row["sequence"],
                "created_at": row["created_at"],
                "event_type": row["event_type"],
                "entity_id": row["entity_id"],
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ]

    def latest_payload(self, entity_id: str, event_type: str | None = None) -> dict[str, Any] | None:
        sql = "SELECT payload_json FROM events WHERE entity_id=?"
        params: list[Any] = [entity_id]
        if event_type:
            sql += " AND event_type=?"
            params.append(event_type)
        sql += " ORDER BY sequence DESC LIMIT 1"
        with self._connect() as connection:
            row = connection.execute(sql, params).fetchone()
        return json.loads(row[0]) if row else None

    def claim_idempotency(self, key: str, action_id: str) -> bool:
        try:
            with self._connect() as connection:
                connection.execute(
                    "INSERT INTO idempotency(idempotency_key,action_id,claimed_at) VALUES(?,?,?)",
                    (key, action_id, utc_now()),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def provider_events(self, request_id: str) -> list[dict[str, Any]]:
        return [event for event in self.events(request_id) if event["event_type"] == "provider_call"]
