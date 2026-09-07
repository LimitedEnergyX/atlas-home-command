from __future__ import annotations

import os
from copy import deepcopy
from typing import Any

from ..schemas import normalized_provider_output
from .base import ATLAS_OUTPUT_SCHEMA, ProviderAdapter, provider_instructions, provider_prompt
from .http import post_json


def _structured_output_schema() -> dict[str, Any]:
    schema = deepcopy(ATLAS_OUTPUT_SCHEMA)
    confidence = schema["properties"]["confidence"]
    confidence.pop("minimum", None)
    confidence.pop("maximum", None)
    confidence["description"] = "A number from 0 through 1 inclusive."
    return schema


class AnthropicProvider(ProviderAdapter):
    name = "anthropic"

    def __init__(self) -> None:
        self.api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        self.model = os.environ.get("ATLAS_ANTHROPIC_MODEL") or os.environ.get("ANTHROPIC_MODEL", "")
        self.base_url = os.environ.get("ATLAS_ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1")
        self.input_rate = float(os.environ.get("ATLAS_ANTHROPIC_INPUT_USD_PER_M", "0"))
        self.output_rate = float(os.environ.get("ATLAS_ANTHROPIC_OUTPUT_USD_PER_M", "0"))

    def available(self) -> tuple[bool, str | None]:
        if not self.api_key:
            return False, "ANTHROPIC_API_KEY is not configured"
        if not self.model:
            return False, "ATLAS_ANTHROPIC_MODEL is not configured"
        return True, None

    def generate(self, request: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
        available, reason = self.available()
        if not available:
            raise RuntimeError(reason)
        response = post_json(
            f"{self.base_url.rstrip('/')}/messages",
            {
                "model": self.model,
                "max_tokens": 1200,
                "system": provider_instructions(request),
                "messages": [{"role": "user", "content": provider_prompt(request)}],
                "output_config": {
                    "format": {
                        "type": "json_schema",
                        "schema": _structured_output_schema(),
                    }
                },
            },
            {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
            timeout_seconds,
        )
        text = "".join(
            block.get("text", "")
            for block in response.get("content", [])
            if isinstance(block, dict) and block.get("type") == "text"
        )
        output = normalized_provider_output(text)
        usage = response.get("usage", {})
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        output["usage"] = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        }
        return output

    def estimated_cost(self, usage: dict[str, int]) -> float:
        return round(
            usage.get("input_tokens", 0) * self.input_rate / 1_000_000
            + usage.get("output_tokens", 0) * self.output_rate / 1_000_000,
            8,
        )
