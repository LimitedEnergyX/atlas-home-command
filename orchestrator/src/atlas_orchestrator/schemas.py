from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timezone
from typing import Any


PROVIDER_POLICIES = {"single", "fallback", "compare", "local-only", "auto"}
TASK_CLASSES = {"routine", "extraction", "classification", "summarization", "complex", "planning", "coding", "review"}
PRIVACY_CLASSES = {"household", "private", "sensitive", "restricted"}
ACTION_CLASSES = {
    "routine-reversible",
    "controlled-change",
    "material",
    "deterministic-emergency",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def require_object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def validate_request(raw: dict[str, Any]) -> dict[str, Any]:
    request = dict(require_object(raw, "request"))
    intent = request.get("intent")
    if not isinstance(intent, str) or not intent.strip():
        raise ValueError("intent must be a non-empty string")
    policy = request.get("provider_policy", "compare")
    if policy not in PROVIDER_POLICIES:
        raise ValueError(f"provider_policy must be one of {sorted(PROVIDER_POLICIES)}")
    deadline_ms = request.get("deadline_ms", 90_000)
    if not isinstance(deadline_ms, int) or not 100 <= deadline_ms <= 120_000:
        raise ValueError("deadline_ms must be an integer from 100 through 120000")
    providers = request.get("providers")
    if providers is not None and (
        not isinstance(providers, list) or not all(isinstance(item, str) for item in providers)
    ):
        raise ValueError("providers must be an array of names")
    request.setdefault("request_id", new_id("req"))
    request.setdefault("created_at", utc_now())
    request.setdefault("operator_context", {})
    request.setdefault("inputs", {})
    request.setdefault("constraints", {})
    request.setdefault("privacy_class", "household")
    privacy_class = request["privacy_class"]
    if privacy_class not in PRIVACY_CLASSES:
        raise ValueError(f"privacy_class must be one of {sorted(PRIVACY_CLASSES)}")
    request.setdefault("task_class", "routine")
    task_class = request["task_class"]
    if task_class not in TASK_CLASSES:
        raise ValueError(f"task_class must be one of {sorted(TASK_CLASSES)}")
    spend_limit = request.get("spend_limit", 0.0)
    if (
        isinstance(spend_limit, bool)
        or not isinstance(spend_limit, (int, float))
        or not math.isfinite(float(spend_limit))
        or float(spend_limit) < 0
    ):
        raise ValueError("spend_limit must be a finite non-negative number")
    request["spend_limit"] = float(spend_limit)
    request["provider_policy"] = policy
    request["deadline_ms"] = deadline_ms
    if request.get("requested_action") is not None:
        request["requested_action"] = validate_action(request["requested_action"])
    return request


def validate_action(raw: dict[str, Any]) -> dict[str, Any]:
    action = dict(require_object(raw, "requested_action"))
    for field in ("adapter", "operation", "target", "action_class"):
        if not isinstance(action.get(field), str) or not action[field].strip():
            raise ValueError(f"requested_action.{field} must be a non-empty string")
    if action["action_class"] not in ACTION_CLASSES:
        raise ValueError(f"requested_action.action_class must be one of {sorted(ACTION_CLASSES)}")
    action.setdefault("action_id", new_id("act"))
    action.setdefault("parameters", {})
    action.setdefault("authority_basis", "mvp-sandbox-policy")
    action.setdefault("risks", [])
    action.setdefault("validation", {})
    action.setdefault("rollback_or_recovery", "restore observed sandbox value")
    action.setdefault("idempotency_key", new_id("idem"))
    return action


def normalized_provider_output(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("provider returned non-JSON output") from exc
    data = require_object(value, "provider output")
    required = (
        "recommendation",
        "reasoning_summary",
        "assumptions",
        "risks",
        "confidence",
        "proposed_actions",
    )
    missing = [field for field in required if field not in data]
    if missing:
        raise ValueError(f"provider output missing fields: {', '.join(missing)}")
    if not isinstance(data["recommendation"], str) or not isinstance(data["reasoning_summary"], str):
        raise ValueError("recommendation and reasoning_summary must be strings")
    if not isinstance(data["assumptions"], list) or not isinstance(data["risks"], list):
        raise ValueError("assumptions and risks must be arrays")
    if not isinstance(data["proposed_actions"], list):
        raise ValueError("proposed_actions must be an array")
    confidence = float(data["confidence"])
    if not 0.0 <= confidence <= 1.0:
        raise ValueError("confidence must be between 0 and 1")
    return {
        "recommendation": data["recommendation"],
        "reasoning_summary": data["reasoning_summary"],
        "assumptions": [str(item) for item in data["assumptions"]],
        "risks": [str(item) for item in data["risks"]],
        "confidence": confidence,
        "proposed_actions": [str(item) for item in data["proposed_actions"]],
    }
