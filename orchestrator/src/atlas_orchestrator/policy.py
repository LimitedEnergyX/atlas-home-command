from __future__ import annotations

from typing import Any


class ActionPolicy:
    """Fail-closed MVP implementation of the approved authority matrix."""

    def decide(
        self,
        action: dict[str, Any],
        *,
        confirmation_id: str | None = None,
        analysis_available: bool = True,
    ) -> dict[str, Any]:
        action_class = action["action_class"]
        adapter = action["adapter"]
        if not analysis_available:
            return self._decision("deny", "provider-total-outage", "No successful analysis is available.")
        if adapter not in {"mock", "status"}:
            return self._decision("deny", "mvp-adapter-boundary", "Only sandbox adapters are permitted.")
        if action_class in {"material", "deterministic-emergency"}:
            return self._decision("deny", "mvp-material-deny", "The MVP never executes this action class.")
        if action_class == "controlled-change" and not confirmation_id:
            return self._decision(
                "confirmation-required",
                "controlled-change-confirmation",
                "A current operator confirmation is required.",
            )
        return {
            **self._decision("allow", "mvp-sandbox-allow", "Sandbox action is within the approved boundary."),
            "confirmation_id": confirmation_id,
        }
    @staticmethod
    def _decision(decision: str, rule: str, reason: str) -> dict[str, Any]:
        return {
            "decision": decision,
            "policy_rule": rule,
            "delegation_id": None,
            "confirmation_id": None,
            "reason": reason,
            "expires_at": None,
        }
