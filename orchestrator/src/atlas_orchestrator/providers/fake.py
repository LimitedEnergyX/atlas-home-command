from __future__ import annotations

import time
from typing import Any

from .base import ProviderAdapter


class FakeProvider(ProviderAdapter):
    is_local = True
    provider_kind = "deterministic-sandbox"

    def __init__(
        self,
        name: str,
        *,
        mode: str = "success",
        delay_seconds: float = 0.0,
        confidence: float = 0.75,
    ) -> None:
        self.name = name
        self.model = "deterministic-fake-v1"
        self.mode = mode
        self.delay_seconds = delay_seconds
        self.confidence = confidence
        self.calls = 0

    def available(self) -> tuple[bool, str | None]:
        return (self.mode != "unavailable", None if self.mode != "unavailable" else "fake unavailable")

    def generate(self, request: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
        self.calls += 1
        if self.delay_seconds:
            if self.delay_seconds > timeout_seconds:
                time.sleep(timeout_seconds)
                raise TimeoutError("deterministic fake provider timeout")
            time.sleep(self.delay_seconds)
        if self.mode in {"failure", "unavailable"}:
            raise RuntimeError("deterministic fake provider failure")
        if self.mode == "malformed":
            raise ValueError("provider output missing fields: recommendation")
        return {
            "recommendation": f"{self.name} recommends evaluating: {request['intent']}",
            "reasoning_summary": "Deterministic sandbox analysis completed.",
            "assumptions": ["This is a sandbox request."],
            "risks": ["No real target was contacted."],
            "confidence": self.confidence,
            "proposed_actions": [],
            "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
        }
