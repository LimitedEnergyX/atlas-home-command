from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from ..schemas import normalized_provider_output
from .base import ATLAS_CHAT_OUTPUT_SCHEMA, ATLAS_OUTPUT_SCHEMA, ProviderAdapter, provider_instructions, provider_prompt
from .http import post_json


OLLAMA_CONTEXT_TOKENS = 16384


class OllamaProvider(ProviderAdapter):
    name = "ollama"
    is_local = True
    provider_kind = "local-model"

    def __init__(self) -> None:
        self.model = os.environ.get("ATLAS_OLLAMA_MODEL", "")
        self.base_url = os.environ.get("ATLAS_OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        self.hermes_url = os.environ.get("ATLAS_HERMES_API_URL", "").rstrip("/")
        self.hermes_key = os.environ.get("ATLAS_HERMES_API_KEY", "")
        self.hermes_session_id = os.environ.get("ATLAS_HERMES_SESSION_ID", "atlas-household")

    def _validated_base_url(self) -> str:
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("ATLAS_OLLAMA_BASE_URL must use loopback HTTP")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("ATLAS_OLLAMA_BASE_URL contains unsupported components")
        return self.base_url.rstrip("/")

    def available(self) -> tuple[bool, str | None]:
        if self.hermes_url:
            if not self.hermes_key:
                return False, "Hermes API key is not configured"
            try:
                request = urllib.request.Request(
                    f"{self.hermes_url}/v1/models",
                    headers={"Authorization": f"Bearer {self.hermes_key}"},
                    method="GET",
                )
                with urllib.request.urlopen(request, timeout=1.5) as response:
                    if response.status != 200:
                        return False, f"Hermes API returned HTTP {response.status}"
            except (ValueError, urllib.error.URLError, TimeoutError, OSError) as exc:
                return False, f"Hermes unavailable: {type(exc).__name__}"
            return True, None
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
        output_schema = ATLAS_CHAT_OUTPUT_SCHEMA if request.get("task_surface") == "chat" else ATLAS_OUTPUT_SCHEMA
        messages = [
            {"role": "system", "content": provider_instructions(request)},
            {
                "role": "user",
                "content": f"Request:\n{prompt}\n\nRequired JSON schema:\n{json.dumps(output_schema, sort_keys=True)}",
            },
        ]
        if self.hermes_url:
            response = post_json(
                f"{self.hermes_url}/v1/chat/completions",
                {
                    "model": "hermes-agent",
                    "messages": messages,
                    "temperature": 0,
                    "stream": False,
                    "response_format": {"type": "json_object"},
                },
                {"Authorization": f"Bearer {self.hermes_key}", "X-Hermes-Session-Id": self.hermes_session_id},
                timeout_seconds,
            )
            choices = response.get("choices", [])
            content = choices[0].get("message", {}).get("content") if choices else None
            if not isinstance(content, str):
                raise ValueError("Hermes response did not contain message content")
            try:
                output = normalized_provider_output(content)
            except ValueError:
                # Hermes is the agent layer and may return natural language even
                # when an OpenAI-compatible client requests JSON. Preserve that
                # response without pretending it is structured model evidence.
                output = {
                    "recommendation": content.strip(),
                    "reasoning_summary": "Response returned by the local Hermes agent.",
                    "assumptions": [],
                    "risks": ["The agent response was not machine-structured."],
                    "confidence": 0.65,
                    "proposed_actions": [],
                }
            output["usage"] = response.get("usage", {})
            return output
        # A conservative byte bound, not a tokenizer estimate. Reserve space for
        # chat-template overhead and the 512-token answer. Never trim the charter
        # or silently rely on Ollama's default context-window truncation.
        if sum(len(message["content"].encode("utf-8")) for message in messages) + 1024 > OLLAMA_CONTEXT_TOKENS:
            raise ValueError("Atlas AI request exceeds the bounded local context with the complete AI rules. Shorten the message or conversation history and retry; the rules were not truncated.")
        response = post_json(
            f"{self._validated_base_url()}/api/chat",
            {
                "model": self.model,
                "messages": messages,
                "format": output_schema,
                "stream": False,
                "think": False,
                "keep_alive": "10m",
                "options": {"temperature": 0, "num_predict": 512, "num_ctx": OLLAMA_CONTEXT_TOKENS},
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
