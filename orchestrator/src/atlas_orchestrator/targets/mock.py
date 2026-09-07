from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


class MockTarget:
    name = "mock"
    writable = True

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write({})

    def _read(self) -> dict[str, Any]:
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, state: dict[str, Any]) -> None:
        handle, temporary = tempfile.mkstemp(prefix="atlas-mock-", suffix=".json", dir=self.path.parent)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump(state, stream, indent=2, sort_keys=True)
                stream.write("\n")
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @staticmethod
    def _key(action: dict[str, Any]) -> str:
        key = action.get("parameters", {}).get("key")
        if not isinstance(key, str) or not key:
            raise ValueError("mock set requires a non-empty parameters.key")
        return key

    def observe(self, action: dict[str, Any]) -> dict[str, Any]:
        key = self._key(action)
        state = self._read()
        return {"key": key, "exists": key in state, "value": state.get(key)}

    def preview(self, action: dict[str, Any]) -> dict[str, Any]:
        if action["operation"] != "set":
            raise ValueError("the MVP mock adapter supports only the set operation")
        before = self.observe(action)
        return {
            "adapter": self.name,
            "operation": "set",
            "target": action["target"],
            "before": before,
            "after": {"key": before["key"], "exists": True, "value": action["parameters"].get("value")},
        }

    def apply(self, action: dict[str, Any]) -> dict[str, Any]:
        key = self._key(action)
        state = self._read()
        state[key] = action["parameters"].get("value")
        self._write(state)
        return {"key": key, "value": state[key]}

    def verify(self, action: dict[str, Any]) -> dict[str, Any]:
        observed = self.observe(action)
        valid = observed["exists"] and observed["value"] == action["parameters"].get("value")
        if action["parameters"].get("simulate_verify_failure") is True:
            valid = False
        return {"valid": valid, "observed": observed}

    def rollback(self, action: dict[str, Any], before: dict[str, Any]) -> dict[str, Any]:
        key = self._key(action)
        state = self._read()
        if before["exists"]:
            state[key] = before["value"]
        else:
            state.pop(key, None)
        self._write(state)
        observed = self.observe(action)
        return {"succeeded": observed == before, "observed": observed}
