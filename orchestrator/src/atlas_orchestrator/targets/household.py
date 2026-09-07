from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator


def _now() -> str:
    return datetime.now(UTC).isoformat()


class HouseholdTarget:
    """Local-only household profiles, inbox, and direct messages."""

    name = "household"
    writable = True
    profile_ids = {"alex", "sam"}
    recipients = profile_ids | {"household"}
    pin_iterations = 310_000

    def __init__(self, path: Path) -> None:
        self.path = path
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT NOT NULL REFERENCES profiles(id), recipient_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS message_reads (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES profiles(id), read_at TEXT NOT NULL, PRIMARY KEY (message_id, profile_id));
                CREATE TABLE IF NOT EXISTS profile_pins (profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE, salt BLOB NOT NULL, pin_hash BLOB NOT NULL, iterations INTEGER NOT NULL, updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at DESC);
                """
            )
            created = _now()
            connection.executemany(
                "INSERT OR IGNORE INTO profiles(id, name, role, created_at) VALUES (?, ?, ?, ?)",
                (("alex", "Alex", "Administrator", created), ("sam", "Sam", "Household Member", created)),
            )
            connection.execute("UPDATE profiles SET role = 'Household Operator' WHERE id = 'sam'")

    def status(self, profile_id: str) -> dict[str, Any]:
        self._validate_profile(profile_id)
        with self._connect() as connection:
            profiles = [dict(row) for row in connection.execute("SELECT id, name, role FROM profiles ORDER BY name")]
            messages = [dict(row) for row in connection.execute(
                """SELECT m.id, m.sender_id, m.recipient_id, m.body, m.created_at,
                          CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END AS is_read
                     FROM messages m
                LEFT JOIN message_reads r ON r.message_id = m.id AND r.profile_id = ?
                    WHERE m.sender_id = ? OR m.recipient_id IN (?, 'household')
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 100""",
                (profile_id, profile_id, profile_id),
            )]
            pin_configured = connection.execute("SELECT 1 FROM profile_pins WHERE profile_id = 'alex'").fetchone() is not None
        unread = sum(1 for message in messages if not message["is_read"] and message["sender_id"] != profile_id)
        return {"adapter": self.name, "status": "healthy", "current_profile": profile_id, "profiles": profiles, "messages": messages, "unread": unread, "alex_pin_configured": pin_configured, "observed_at": _now()}

    def set_pin(self, profile_id: Any, pin: Any) -> dict[str, Any]:
        self._validate_profile(profile_id)
        if profile_id != "alex":
            raise ValueError("only the Alex profile uses a PIN")
        self._validate_pin(pin)
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, self.pin_iterations)
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO profile_pins(profile_id, salt, pin_hash, iterations, updated_at) VALUES (?, ?, ?, ?, ?)",
                (profile_id, salt, digest, self.pin_iterations, _now()),
            )
        return {"status": "configured", "profile": profile_id}

    def switch_profile(self, profile_id: Any, pin: Any = None) -> dict[str, Any]:
        self._validate_profile(profile_id)
        if profile_id == "sam":
            return {"status": "accepted", "profile": "sam", "pin_required": False}
        self._validate_pin(pin)
        with self._connect() as connection:
            row = connection.execute(
                "SELECT salt, pin_hash, iterations FROM profile_pins WHERE profile_id = ?",
                (profile_id,),
            ).fetchone()
        if row is None:
            return {"status": "not_configured", "profile": profile_id, "pin_required": True}
        actual = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), row["salt"], int(row["iterations"]))
        if not hmac.compare_digest(actual, row["pin_hash"]):
            return {"status": "denied", "profile": profile_id, "pin_required": True}
        return {"status": "accepted", "profile": profile_id, "pin_required": True}

    def send(self, sender_id: Any, recipient_id: Any, body: Any) -> dict[str, Any]:
        self._validate_profile(sender_id)
        if recipient_id not in self.recipients:
            raise ValueError("recipient must be alex, sam, or household")
        if not isinstance(body, str) or not body.strip():
            raise ValueError("message body is required")
        body = body.strip()
        if len(body) > 1000:
            raise ValueError("message body must be 1000 characters or fewer")
        created = _now()
        with self._connect() as connection:
            cursor = connection.execute("INSERT INTO messages(sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)", (sender_id, recipient_id, body, created))
            message_id = int(cursor.lastrowid)
            connection.execute("INSERT INTO message_reads(message_id, profile_id, read_at) VALUES (?, ?, ?)", (message_id, sender_id, created))
        return {"status": "accepted", "message_id": message_id, "created_at": created}

    def mark_read(self, message_id: Any, profile_id: Any) -> dict[str, Any]:
        self._validate_profile(profile_id)
        try:
            parsed_id = int(message_id)
        except (TypeError, ValueError) as exc:
            raise ValueError("message id must be an integer") from exc
        with self._connect() as connection:
            visible = connection.execute("SELECT 1 FROM messages WHERE id = ? AND (sender_id = ? OR recipient_id IN (?, 'household'))", (parsed_id, profile_id, profile_id)).fetchone()
            if not visible:
                raise KeyError(parsed_id)
            connection.execute("INSERT OR REPLACE INTO message_reads(message_id, profile_id, read_at) VALUES (?, ?, ?)", (parsed_id, profile_id, _now()))
        return {"status": "accepted", "message_id": parsed_id}

    def delete(self, message_id: Any, profile_id: Any) -> dict[str, Any]:
        self._validate_profile(profile_id)
        try:
            parsed_id = int(message_id)
        except (TypeError, ValueError) as exc:
            raise ValueError("message id must be an integer") from exc
        with self._connect() as connection:
            visible = connection.execute(
                "SELECT 1 FROM messages WHERE id = ? AND (sender_id = ? OR recipient_id IN (?, 'household'))",
                (parsed_id, profile_id, profile_id),
            ).fetchone()
            if not visible:
                raise KeyError(parsed_id)
            connection.execute("DELETE FROM messages WHERE id = ?", (parsed_id,))
        return {"status": "deleted", "message_id": parsed_id}

    @classmethod
    def _validate_profile(cls, profile_id: Any) -> None:
        if profile_id not in cls.profile_ids:
            raise ValueError("profile must be alex or sam")

    @staticmethod
    def _validate_pin(pin: Any) -> None:
        if not isinstance(pin, str) or len(pin) != 6 or not pin.isascii() or not pin.isdigit():
            raise ValueError("PIN must contain exactly 6 digits")
