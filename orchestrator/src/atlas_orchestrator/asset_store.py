"""Tenant-aware household assets for Argo and future cross-domain links.

This store begins empty. Operator-imported continuity facts are separate
from live vehicle telemetry so identity and recovery information remain useful
when an external API is unavailable.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


TENANT_ZERO = 0

SEED_ASSETS = ()


class AssetStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(
                """
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS tenants (
                    id INTEGER PRIMARY KEY,
                    slug TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    kind TEXT NOT NULL,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    manufacturer TEXT NOT NULL,
                    model TEXT NOT NULL,
                    model_year INTEGER,
                    summary TEXT NOT NULL,
                    source TEXT NOT NULL,
                    details_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (tenant_id, name)
                );
                CREATE INDEX IF NOT EXISTS idx_assets_tenant_kind
                    ON assets (tenant_id, kind, name);
                CREATE TABLE IF NOT EXISTS asset_identifiers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                    identifier_type TEXT NOT NULL,
                    value TEXT NOT NULL,
                    authority TEXT NOT NULL,
                    effective_from TEXT,
                    effective_to TEXT,
                    UNIQUE (tenant_id, asset_id, identifier_type, value)
                );
                CREATE TABLE IF NOT EXISTS asset_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                    event_date TEXT NOT NULL,
                    category TEXT NOT NULL,
                    title TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    state TEXT NOT NULL,
                    mandatory INTEGER NOT NULL DEFAULT 0,
                    UNIQUE (tenant_id, asset_id, event_date, category, title)
                );
                """
            )
            self._seed(db)

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
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _seed(self, db: sqlite3.Connection) -> None:
        now = self._now()
        db.execute(
            "INSERT OR IGNORE INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)",
            (TENANT_ZERO, "household", "Example Household", now),
        )
        for asset in SEED_ASSETS:
            db.execute(
                """INSERT OR IGNORE INTO assets
                   (id, tenant_id, kind, name, status, manufacturer, model,
                    model_year, summary, source, details_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    asset["id"], TENANT_ZERO, asset["kind"], asset["name"],
                    asset["status"], asset["manufacturer"], asset["model"],
                    asset["model_year"], asset["summary"], asset["source"],
                    json.dumps(asset["details"], separators=(",", ":")), now, now,
                ),
            )
            for kind, value, authority in asset["identifiers"]:
                db.execute(
                    """INSERT OR IGNORE INTO asset_identifiers
                       (tenant_id, asset_id, identifier_type, value, authority)
                       VALUES (?, ?, ?, ?, ?)""",
                    (TENANT_ZERO, asset["id"], kind, value, authority),
                )
            for event_date, category, title, detail, state, mandatory in asset["events"]:
                db.execute(
                    """INSERT OR IGNORE INTO asset_events
                       (tenant_id, asset_id, event_date, category, title, detail, state, mandatory)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (TENANT_ZERO, asset["id"], event_date, category, title, detail, state, int(mandatory)),
                )

    def status(self, tenant_id: int = TENANT_ZERO) -> dict:
        with self.connect() as db:
            tenant = db.execute(
                "SELECT id, slug, name FROM tenants WHERE id = ?", (tenant_id,)
            ).fetchone()
            if tenant is None:
                raise ValueError("Tenant not found")
            asset_rows = db.execute(
                "SELECT * FROM assets WHERE tenant_id = ? ORDER BY name", (tenant_id,)
            ).fetchall()
            assets = []
            for row in asset_rows:
                asset = dict(row)
                asset["details"] = json.loads(asset.pop("details_json") or "{}")
                asset["identifiers"] = [
                    dict(item) for item in db.execute(
                        """SELECT identifier_type AS type, value, authority,
                                  effective_from, effective_to
                           FROM asset_identifiers
                           WHERE tenant_id = ? AND asset_id = ?
                           ORDER BY identifier_type, value""",
                        (tenant_id, asset["id"]),
                    )
                ]
                asset["events"] = [
                    {**dict(item), "mandatory": bool(item["mandatory"])}
                    for item in db.execute(
                        """SELECT event_date, category, title, detail, state, mandatory
                           FROM asset_events
                           WHERE tenant_id = ? AND asset_id = ?
                           ORDER BY event_date, category, title""",
                        (tenant_id, asset["id"]),
                    )
                ]
                assets.append(asset)
        return {
            "status": "healthy",
            "tenant": dict(tenant),
            "observed_at": self._now(),
            "summary": {
                "vehicles": len(assets),
                "active": sum(item["status"] == "active" for item in assets),
                "profiles_needed": sum(item["status"] == "profile-needed" for item in assets),
            },
            "assets": assets,
            "provenance": "Local vehicle records. Independent of periodic Tesla readings.",
        }
