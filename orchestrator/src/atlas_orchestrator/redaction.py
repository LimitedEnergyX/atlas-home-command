from __future__ import annotations

import re
from typing import Any, Iterable


SENSITIVE_KEY = re.compile(r"(?:api[-_]?key|token|password|secret|credential)", re.I)
BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")


class Redactor:
    def __init__(self, secret_values: Iterable[str] = ()) -> None:
        self._secrets = tuple(value for value in secret_values if value)

    def redact(self, value: Any) -> Any:
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                name = str(key)
                header_secret = name.lower() == "authorization" and isinstance(item, str)
                result[name] = "[REDACTED]" if SENSITIVE_KEY.search(name) or header_secret else self.redact(item)
            return result
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        if isinstance(value, tuple):
            return [self.redact(item) for item in value]
        if isinstance(value, str):
            result = BEARER.sub("Bearer [REDACTED]", value)
            for secret in self._secrets:
                result = result.replace(secret, "[REDACTED]")
            return result
        return value
