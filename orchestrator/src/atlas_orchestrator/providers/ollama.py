from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from ..schemas import normalized_provider_output
from .base import ATLAS_OUTPUT_SCHEMA, ProviderAdapter, provider_instructions, provider_prompt
from .http import post_json


class OllamaProvider(ProviderAdapter):
    name = "ollama"
    is_local = True
    provider_kind = "local-model"

    def __init__(self) -> None:
        self.model = os.environ.get("ATLAS_OLLAMA_MODEL", "")
        self.base_url = os.environ.get("ATLAS_OLLAMA_BASE_URL", "http://127.0.0.1:11434")

    def _validated_base_url(self) -> str:
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("ATLAS_OLLAMA_BASE_URL must use loopback HTTP")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("ATLAS_OLLAMA_BASE_URL contains unsupported components")
        return self.base_url.rstrip("/")

    def available(self) -> tuple[bool, str | None]:
        if not self.model:
            return False, "ATLAS_OLLAMA_MODEL is not configured"
        try:
            request = urllib.request.Request(f"{self._validated_base_url()}/api/tags", method="GET")
            with urllib.request.urlopen(request, timeout=1.0) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (ValueError, json.JSONDecodeError, urllib.error.URLError, TimeoutError, OSError) as exc:
            return False, f"Ollama unavailable: {type(exc).__name__}"
        models = {
            str(item.get("name", ""))
            for item in payload.get("models", [])
            if isinstance(item, dict)
        }
        if self.model not in models:
            return False, f"Ollama model is not installed: {self.model}"
        return True, None

    def generate(self, request: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
        available, reason = self.available()
        if not available:
            raise RuntimeError(reason)
        prompt = provider_prompt(request)
        response = post_json(
            f"{self._validated_base_url()}/api/chat",
            {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": provider_instructions(request)},
                    {
                        "role": "user",
                        "content": f"Request:\n{prompt}\n\nRequired JSON schema:\n{json.dumps(ATLAS_OUTPUT_SCHEMA, sort_keys=True)}",
                    },
                ],
                "format": ATLAS_OUTPUT_SCHEMA,
                "stream": False,
                "think": False,
                "keep_alive": "10m",
                "options": {"temperature": 0, "num_predict": 512},
            },
            {},
            timeout_seconds,
        )
        message = response.get("message", {})
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str):
            raise ValueError("Ollama response did not contain message content")
        output = normalized_provider_output(content)
        input_tokens = int(response.get("prompt_eval_count", 0))
        output_tokens = int(response.get("eval_count", 0))
        output["usage"] = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        }
        return output
