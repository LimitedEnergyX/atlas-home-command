from __future__ import annotations

import os
from typing import Any

from ..schemas import normalized_provider_output
from .base import ATLAS_OUTPUT_SCHEMA, ProviderAdapter, extract_response_text, provider_instructions, provider_prompt
from .http import post_json


class OpenAIProvider(ProviderAdapter):
    name = "openai"
    structured_responses = True

    def __init__(self) -> None:
        self.api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        self.model = os.environ.get("ATLAS_OPENAI_MODEL", "")
        self.base_url = os.environ.get("ATLAS_OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.input_rate = float(os.environ.get("ATLAS_OPENAI_INPUT_USD_PER_M", "0"))
        self.output_rate = float(os.environ.get("ATLAS_OPENAI_OUTPUT_USD_PER_M", "0"))

    def available(self) -> tuple[bool, str | None]:
        if not self.api_key:
            return False, "OPENAI_API_KEY is not configured"
        if not self.model:
            return False, "ATLAS_OPENAI_MODEL is not configured"
        return True, None

    def generate(self, request: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
        available, reason = self.available()
        if not available:
            raise RuntimeError(reason)
        payload = {
            "model": self.model,
            "instructions": provider_instructions(request),
            "input": provider_prompt(request),
            "store": False,
        }
        if self.structured_responses:
            payload["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": "atlas_provider_analysis",
                    "strict": True,
                    "schema": ATLAS_OUTPUT_SCHEMA,
                }
            }
        response = post_json(
            f"{self.base_url.rstrip('/')}/responses",
            payload,
            {"Authorization": f"Bearer {self.api_key}"},
            timeout_seconds,
        )
        output = normalized_provider_output(extract_response_text(response))
        usage = response.get("usage", {})
        output["usage"] = {
            "input_tokens": int(usage.get("input_tokens", 0)),
            "output_tokens": int(usage.get("output_tokens", 0)),
            "total_tokens": int(usage.get("total_tokens", 0)),
        }
        return output

    def estimated_cost(self, usage: dict[str, int]) -> float:
        return round(
            usage.get("input_tokens", 0) * self.input_rate / 1_000_000
            + usage.get("output_tokens", 0) * self.output_rate / 1_000_000,
            8,
        )
