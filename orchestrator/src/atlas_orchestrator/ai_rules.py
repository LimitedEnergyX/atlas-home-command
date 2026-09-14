"""Load the complete, approved Atlas charter without a permissive fallback."""
from __future__ import annotations

import hashlib
from pathlib import Path


AI_RULES_SHA256 = "7d2b000b6ad0a338b5c696a746c8ed91b1986406be3f0dd9709860703dc4fcb5"
PACKAGED_RULES_PATH = Path(__file__).with_name("AI_RULES.md")
SOURCE_ROOT = Path(__file__).resolve().parents[3]
CANONICAL_RULES_PATH = SOURCE_ROOT / "AI_RULES.md"


def _verified_text(path: Path) -> str:
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise RuntimeError("Atlas AI is unavailable: the required AI_RULES.md is missing or unreadable.") from exc
    if hashlib.sha256(payload).hexdigest() != AI_RULES_SHA256:
        raise RuntimeError("Atlas AI is unavailable: AI_RULES.md does not match the approved charter. Restore or explicitly approve and synchronize the rules before using AI.")
    return payload.decode("utf-8")


def load_ai_rules() -> str:
    # Read on each request, not at startup: a broken AI charter must not prevent
    # manual household controls or health endpoints from starting or operating.
    packaged = _verified_text(PACKAGED_RULES_PATH)
    if CANONICAL_RULES_PATH.exists() or (SOURCE_ROOT / "orchestrator" / "pyproject.toml").exists():
        if _verified_text(CANONICAL_RULES_PATH) != packaged:
            raise RuntimeError("Atlas AI is unavailable: canonical and packaged AI rules differ.")
    return packaged
