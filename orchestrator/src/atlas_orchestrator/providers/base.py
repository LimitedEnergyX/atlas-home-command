from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


ATLAS_OUTPUT_SCHEMA = {
    "type": "object",
    "required": ["recommendation", "reasoning_summary", "assumptions", "risks", "confidence", "proposed_actions"],
    "properties": {
        "recommendation": {"type": "string"},
        "reasoning_summary": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "proposed_actions": {"type": "array", "items": {"type": "string"}},
    },
    "additionalProperties": False,
}


SYSTEM_INSTRUCTIONS = """You are one analysis provider inside Atlas Orchestrator.
Return only a JSON object with recommendation, reasoning_summary, assumptions, risks,
confidence (0 through 1), and proposed_actions. Never claim authority to execute an action.
Do not include secrets or hidden chain-of-thought; reasoning_summary must be concise."""

CHAT_SYSTEM_INSTRUCTIONS = """You are Hermes, the household-facing conversational guide
inside Atlas. Return only a JSON object with recommendation, reasoning_summary,
assumptions, risks, confidence (0 through 1), and proposed_actions. The recommendation
MUST be the actual answer shown to the user. Speak directly to the user in first person.
Never put instructions for another assistant, a description of how to answer, hidden
chain-of-thought, or a response-writing plan in recommendation. Keep reasoning_summary
brief and separate. Never claim authority to execute an action."""


class ProviderAdapter(ABC):
    name: str
    model: str
    is_local: bool = False
    provider_kind: str = "cloud"

    @abstractmethod
    def available(self) -> tuple[bool, str | None]:
        raise NotImplementedError

    @abstractmethod
    def generate(self, request: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
        """Return a normalized provider result or raise a sanitized exception."""
        raise NotImplementedError

    def estimated_cost(self, usage: dict[str, int]) -> float:
        return 0.0


def provider_prompt(request: dict[str, Any]) -> str:
    import json

    safe_request = {
        "intent": request["intent"],
        "inputs": request.get("inputs", {}),
        "constraints": request.get("constraints", {}),
        "privacy_class": request.get("privacy_class", "household"),
    }
    return json.dumps(safe_request, sort_keys=True)


def provider_instructions(request: dict[str, Any]) -> str:
    return CHAT_SYSTEM_INSTRUCTIONS if request.get("task_surface") == "chat" else SYSTEM_INSTRUCTIONS


def extract_response_text(response: dict[str, Any]) -> str:
    direct = response.get("output_text")
    if isinstance(direct, str):
        return direct
    for output in response.get("output", []):
        if not isinstance(output, dict):
            continue
        for block in output.get("content", []):
            if isinstance(block, dict) and block.get("type") == "output_text":
                text = block.get("text")
                if isinstance(text, str):
                    return text
    raise ValueError("provider response did not contain output text")
