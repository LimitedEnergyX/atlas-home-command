from __future__ import annotations

import time
import os
import re
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any

from .config import Settings, configured_secrets
from .ai_rules import load_ai_rules
from .ledger import Ledger
from .energy_store import EnergyStore
from .asset_store import AssetStore
from .maintenance import MaintenanceStore
from .household_tools import HouseholdTools, authorized_commands, looks_like_household_command
from .household_status import HouseholdStatus
from .cyber import read_snapshot
from .policy import ActionPolicy
from .providers import AnthropicProvider, FakeProvider, OllamaProvider, OpenAIProvider, ProviderAdapter, XAIProvider
from .redaction import Redactor
from .schemas import utc_now, validate_action, validate_request
from .targets import GalleyQuestStatusTarget, HomeInventoryTarget, HomeStatusTarget, HouseholdTarget, JarvisStatusTarget, MockTarget, PowerwallStatusTarget, StatusTarget, TravelTarget, VacationIDSTarget


class AtlasOrchestrator:
    def __init__(
        self,
        settings: Settings,
        providers: dict[str, ProviderAdapter] | None = None,
    ) -> None:
        self.settings = settings
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.redactor = Redactor(configured_secrets())
        self.ledger = Ledger(self.settings.data_dir / "atlas-ledger.sqlite3", self.redactor)
        self.energy_store = EnergyStore(self.settings.data_dir / "energy-history.sqlite3")
        self.assets = AssetStore(self.settings.data_dir / "assets.sqlite3")
        self.maintenance = MaintenanceStore(self.settings.data_dir / "maintenance.sqlite3")
        self.policy = ActionPolicy()
        home_token = os.environ.get("ATLAS_HOME_ASSISTANT_TOKEN", "")
        self.household_tools = HouseholdTools(self.settings.home_assistant_url, home_token)
        self.household_observer = HouseholdStatus(self.household_tools)
        self.targets = {
            "status": StatusTarget(self.settings.data_dir),
            "jarvis-status": JarvisStatusTarget(
                self.settings.jarvis_status_config, redactor=self.redactor
            ),
            "powerwall-status": PowerwallStatusTarget(self.settings.powerwall_status_url),
            "galleyquest-status": GalleyQuestStatusTarget(self.settings.galleyquest_config),
            "home-status": HomeStatusTarget(
                self.settings.home_assistant_url,
                home_token,
            ),
            "home-inventory": HomeInventoryTarget(
                self.settings.home_assistant_url,
                home_token,
                backup_root=os.environ.get(
                    "ATLAS_HOME_BACKUP_ROOT", str(self.settings.data_dir / "home-assistant")
                ),
            ),
            "household": HouseholdTarget(self.settings.data_dir / "household.sqlite3"),
            "travel": TravelTarget(self.settings.data_dir / "travel.json"),
            "vacation-ids": VacationIDSTarget(
                self.settings.home_assistant_url,
                home_token,
                self.settings.data_dir,
                start_monitor=bool(home_token) and os.environ.get("ATLAS_IDS_MONITOR_ENABLED") == "1",
            ),
            "mock": MockTarget(self.settings.data_dir / "sandbox-state.json"),
        }
        self.providers = providers or self._default_providers()

    @staticmethod
    def _default_providers() -> dict[str, ProviderAdapter]:
        adapters: list[ProviderAdapter] = [
            OllamaProvider(),
            OpenAIProvider(),
            AnthropicProvider(),
            XAIProvider(),
            FakeProvider("fake-openai", confidence=0.78),
            FakeProvider("fake-anthropic", confidence=0.76),
            FakeProvider("fake-xai", confidence=0.74),
        ]
        return {provider.name: provider for provider in adapters}

    def health(self) -> dict[str, Any]:
        provider_health = {}
        for name, provider in self.providers.items():
            available, reason = provider.available()
            provider_health[name] = {
                "available": available,
                "model": provider.model or None,
                "reason": reason,
                "local": provider.is_local,
                "kind": provider.provider_kind,
            }
        ledger_ok = self.ledger.health()
        return {
            "status": "healthy" if ledger_ok else "unhealthy",
            "ledger": {"healthy": ledger_ok},
            "providers": provider_health,
            "observed_at": utc_now(),
        }

    def chat(self, raw: dict[str, Any]) -> dict[str, Any]:
        load_ai_rules()
        message = raw.get("message")
        if not isinstance(message, str) or not message.strip():
            raise ValueError("message must be a non-empty string")
        message = message.strip()
        dry_run = raw.get("dry_run", False)
        if not isinstance(dry_run, bool):
            raise ValueError("dry_run must be true or false")
        if len(message) > 12_000:
            raise ValueError("message must be 12000 characters or fewer")

        mode = raw.get("mode", "auto")
        if mode not in {"auto", "local", "review"}:
            raise ValueError("mode must be auto, local, or review")
        history = self._chat_history(raw.get("history", []))
        authorized = authorized_commands(message)
        task_class = self._classify_chat_task(message)
        spend_limit = raw.get("spend_limit", 0.0)
        if mode == "review" and (not isinstance(spend_limit, (int, float)) or float(spend_limit) <= 0):
            raise ValueError("multi-model review requires an explicit positive spend_limit")

        observation = self.household_observer.answer(message) if mode != 'review' else None
        if observation is not None:
            request_id = str(uuid.uuid4())
            self.ledger.append('household_chat_status', request_id, observation)
            return {
                'status': observation['status'], 'request_id': request_id,
                'assistant': {'name': 'Hermes', 'workspace': 'Olympus', 'platform': 'Atlas'},
                'answer': observation['answer'], 'execution': None,
                'observation': observation, 'reasoning_summary': 'Fresh read-only Home Assistant query.',
                'confidence': 0.0 if observation['status'] == 'partial' else 1.0,
                'route': {'mode': mode, 'task_class': 'household_status', 'provider': 'home-assistant',
                          'model': None, 'local_only': True, 'review_level': 'none',
                          'escalation_recommended': False,
                          'escalation_reason': 'Read-only local status; no model inference or cloud spend.'},
            }

        request: dict[str, Any] = {
            "intent": message,
            "inputs": {
                "conversation": history,
                "latest_message": message,
                "household_tools": self.household_tools.catalog(),
                "authorized_household_commands": authorized or [],
                "identity": {
                    "assistant": "Hermes",
                    "workspace": "Olympus",
                    "platform": "Atlas",
                },
            },
            "constraints": {
                "recommendation_is_the_exact_user_facing_answer": True,
                "speak_directly_as_hermes": True,
                "never_return_response_writing_instructions": True,
                "do_not_execute_actions": True,
                "keep_the_response_clear_and_practical": True,
            },
            "task_surface": "chat",
            "task_class": task_class,
            "deadline_ms": 90_000,
            "spend_limit": float(spend_limit),
        }
        if mode == "review":
            request.update({"provider_policy": "compare", "privacy_class": "household"})
        else:
            request.update({"provider_policy": "local-only", "privacy_class": "private"})
            local_names = [
                name
                for name, provider in self.providers.items()
                if provider.is_local and provider.available()[0]
            ]
            if not local_names:
                raise RuntimeError("no local Atlas model is available")
            request["providers"] = ["ollama" if "ollama" in local_names else local_names[0]]

        result = self.orchestrate(request)
        selected = result.get("selected") or {}
        commands = selected.get("tool_commands", [])
        execution = None
        if authorized or commands or looks_like_household_command(message):
            if mode == "review":
                execution = {"status": "blocked", "answer": "Household commands require the local chat route. Nothing was changed.", "results": []}
            else:
                execution = self.household_tools.execute(commands, message, dry_run=dry_run)
            self.ledger.append("household_chat_execution", result["request_id"], execution)
        confidence = float(selected.get("confidence") or 0.0)
        escalation_recommended = mode == "auto" and (
            task_class in {"complex", "planning", "coding", "review"} or confidence < 0.7
        )
        return {
            "status": execution["status"] if execution else result["status"],
            "request_id": result["request_id"],
            "assistant": {"name": "Hermes", "workspace": "Olympus", "platform": "Atlas"},
            "answer": execution["answer"] if execution else selected.get("recommendation") or "I could not produce a local response.",
            "execution": execution,
            "reasoning_summary": selected.get("reasoning_summary"),
            "confidence": confidence,
            "route": {
                "mode": mode,
                "task_class": task_class,
                "provider": selected.get("provider"),
                "model": selected.get("model"),
                "local_only": result["routing"]["local_only"],
                "review_level": result["comparison"]["review_level"],
                "escalation_recommended": escalation_recommended,
                "escalation_reason": (
                    "This request would benefit from independent model review. Cloud review remains off until a positive budget is explicitly authorized."
                    if escalation_recommended
                    else "The local model is the appropriate first route for this request."
                ),
            },
        }

    @staticmethod
    def _chat_history(raw: Any) -> list[dict[str, str]]:
        if not isinstance(raw, list):
            raise ValueError("history must be an array")
        normalized: list[dict[str, str]] = []
        for item in raw[-12:]:
            if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
                raise ValueError("history entries require a user or assistant role")
            content = item.get("content")
            if not isinstance(content, str) or not content.strip():
                raise ValueError("history entries require non-empty content")
            normalized.append({"role": item["role"], "content": content.strip()[:4_000]})
        return normalized

    @staticmethod
    def _classify_chat_task(message: str) -> str:
        lowered = message.lower()
        if any(token in lowered for token in ("review", "audit", "double-check", "verify independently")):
            return "review"
        if any(token in lowered for token in ("write code", "debug", "implement", "refactor", "script")):
            return "coding"
        if any(token in lowered for token in ("plan", "strategy", "architecture", "tradeoff", "compare")):
            return "planning"
        if len(message) > 1_500:
            return "complex"
        return "routine"

    def orchestrate(self, raw_request: dict[str, Any]) -> dict[str, Any]:
        load_ai_rules()
        request = validate_request(raw_request)
        request_id = request["request_id"]
        self.ledger.append("request_received", request_id, request)
        effective_policy, names, routing = self._route_request(request)
        unknown = [name for name in names if name not in self.providers]
        if unknown:
            raise ValueError(f"unknown providers: {', '.join(unknown)}")
        nonlocal_names = [name for name in names if not self.providers[name].is_local]
        if effective_policy == "local-only" and nonlocal_names:
            raise ValueError("local-only policy permits only local providers")
        if nonlocal_names and float(request["spend_limit"]) <= 0:
            raise ValueError("a positive spend_limit is required for cloud providers")
        responses = self._run_policy(request, names, effective_policy)
        successful = [response for response in responses if response["status"] == "success"]
        selected = dict(max(successful, key=lambda item: item["confidence"])) if successful else None
        if selected:
            selected["selection_basis"] = "highest_reported_confidence"
        result: dict[str, Any] = {
            "request_id": request_id,
            "status": "completed" if successful else "failed",
            "provider_policy": request["provider_policy"],
            "effective_provider_policy": effective_policy,
            "routing": routing,
            "responses": responses,
            "selected": selected,
            "comparison": self._comparison_summary(successful, len(names)),
            "completed_at": utc_now(),
        }
        action = request.get("requested_action")
        if action:
            self.ledger.append("action_proposed", action["action_id"], {"request_id": request_id, "action": action})
            decision = self.policy.decide(action, analysis_available=bool(successful))
            result["action"] = {"action_id": action["action_id"], "authorization": decision}
            self.ledger.append("authorization_decision", action["action_id"], decision)
        self.ledger.append("request_completed", request_id, result)
        return result

    def _default_provider_names(self, policy: str) -> list[str]:
        if policy == "local-only":
            local = [
                name
                for name, provider in self.providers.items()
                if provider.is_local
                and not isinstance(provider, FakeProvider)
                and provider.available()[0]
            ]
            return local or ["fake-openai", "fake-anthropic", "fake-xai"]
        configured = [
            name
            for name in ("ollama", "openai", "anthropic", "xai")
            if name in self.providers and self.providers[name].available()[0]
        ]
        return configured or ["fake-openai", "fake-anthropic", "fake-xai"]

    def _route_request(self, request: dict[str, Any]) -> tuple[str, list[str], dict[str, Any]]:
        requested_policy = request["provider_policy"]
        effective_policy = requested_policy
        reason = "operator-selected provider policy"
        if requested_policy == "auto":
            if request["privacy_class"] in {"private", "sensitive", "restricted"}:
                effective_policy = "local-only"
                reason = "privacy class requires local processing"
            elif request["task_class"] in {"routine", "extraction", "classification", "summarization"}:
                effective_policy = "fallback"
                reason = "routine task uses the first successful provider"
            else:
                effective_policy = "compare"
                reason = "complex task benefits from independent provider comparison"
        names = request.get("providers") or self._default_provider_names(effective_policy)
        simulation_only = bool(names) and all(
            name in self.providers and isinstance(self.providers[name], FakeProvider)
            for name in names
        )
        return effective_policy, names, {
            "requested_policy": requested_policy,
            "effective_policy": effective_policy,
            "task_class": request["task_class"],
            "privacy_class": request["privacy_class"],
            "providers": list(names),
            "reason": reason,
            "local_only": effective_policy == "local-only",
            "simulation_only": simulation_only,
        }

    @staticmethod
    def _comparison_summary(successful: list[dict[str, Any]], provider_count: int) -> dict[str, Any]:
        risk_union: list[str] = []
        for response in successful:
            for risk in response.get("risks", []):
                if risk not in risk_union:
                    risk_union.append(risk)
        scores: list[float] = []
        token_sets = []
        for response in successful:
            words = set(re.findall(r"[a-z0-9]+", response["recommendation"].lower()))
            token_sets.append(words)
        for left_index, left in enumerate(token_sets):
            for right in token_sets[left_index + 1 :]:
                union = left | right
                scores.append(len(left & right) / len(union) if union else 1.0)
        return {
            "successful_providers": len(successful),
            "requested_providers": provider_count,
            "review_level": "multi-source" if len(successful) > 1 else "single-source",
            "lexical_agreement": round(sum(scores) / len(scores), 3) if scores else None,
            "risk_union": risk_union,
            "authority_effect": "none",
        }

    def _run_policy(
        self, request: dict[str, Any], names: list[str], policy: str | None = None
    ) -> list[dict[str, Any]]:
        policy = policy or request["provider_policy"]
        deadline_at = time.monotonic() + request["deadline_ms"] / 1000
        if not names:
            return []
        if policy == "single":
            return [self._call_provider(self.providers[names[0]], request, deadline_at=deadline_at)]
        if policy == "fallback":
            results = []
            for name in names:
                result = self._call_provider(self.providers[name], request, deadline_at=deadline_at)
                results.append(result)
                if result["status"] == "success":
                    break
            return results
        return self._call_parallel(request, names, deadline_at)

    def _call_parallel(
        self, request: dict[str, Any], names: list[str], deadline_at: float
    ) -> list[dict[str, Any]]:
        worker_count = min(len(names), self.settings.max_provider_workers)
        executor = ThreadPoolExecutor(max_workers=max(1, worker_count), thread_name_prefix="atlas-provider")
        futures: dict[Future[dict[str, Any]], str] = {
            executor.submit(self._call_provider, self.providers[name], request, False, deadline_at): name
            for name in names
        }
        timeout = max(0, deadline_at - time.monotonic())
        done, pending = wait(futures, timeout=timeout)
        results = [future.result() for future in done]
        for result in results:
            self.ledger.append("provider_call", request["request_id"], result)
        for future in pending:
            name = futures[future]
            future.cancel()
            result = self._provider_failure(
                self.providers[name], request, "deadline exceeded", request["deadline_ms"], record=True
            )
            results.append(result)
        executor.shutdown(wait=False, cancel_futures=True)
        order = {name: index for index, name in enumerate(names)}
        return sorted(results, key=lambda item: order[item["provider"]])

    def _call_provider(
        self,
        provider: ProviderAdapter,
        request: dict[str, Any],
        record: bool = True,
        deadline_at: float | None = None,
    ) -> dict[str, Any]:
        started = time.monotonic()
        deadline_at = deadline_at or started + request["deadline_ms"] / 1000
        error: Exception | None = None
        attempts = self.settings.retry_budget + 1
        attempts_made = 0
        safe_request = self.redactor.redact(request)
        for attempt in range(1, attempts + 1):
            remaining = deadline_at - time.monotonic()
            if remaining <= 0:
                error = TimeoutError("request deadline exceeded")
                break
            try:
                attempts_made = attempt
                output = provider.generate(safe_request, max(0.01, remaining))
                latency_ms = round((time.monotonic() - started) * 1000, 2)
                usage = output.pop("usage", {})
                result = {
                    "provider": provider.name,
                    "model": provider.model,
                    "status": "success",
                    "latency_ms": latency_ms,
                    "attempts": attempt,
                    "usage": usage,
                    "estimated_cost": provider.estimated_cost(usage),
                    **output,
                    "error": None,
                }
                if record:
                    self.ledger.append("provider_call", request["request_id"], result)
                return result
            except Exception as exc:  # provider boundary deliberately normalizes all failures
                error = exc
        latency_ms = round((time.monotonic() - started) * 1000, 2)
        return self._provider_failure(provider, request, str(error), latency_ms, attempts_made, record)

    def _provider_failure(
        self,
        provider: ProviderAdapter,
        request: dict[str, Any],
        message: str,
        latency_ms: float,
        attempts: int = 1,
        record: bool = True,
    ) -> dict[str, Any]:
        result = {
            "provider": provider.name,
            "model": provider.model,
            "status": "error",
            "latency_ms": latency_ms,
            "attempts": attempts,
            "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
            "estimated_cost": 0.0,
            "recommendation": None,
            "reasoning_summary": None,
            "assumptions": [],
            "risks": [],
            "confidence": 0.0,
            "proposed_actions": [],
            "error": {"type": "provider_error", "message": self.redactor.redact(message)},
        }
        if record:
            self.ledger.append("provider_call", request["request_id"], result)
        return result

    def request_record(self, request_id: str) -> dict[str, Any] | None:
        events = self.ledger.events(request_id)
        if not events:
            return None
        return {"request_id": request_id, "events": events, "latest": events[-1]["payload"]}

    def action(self, action_id: str) -> dict[str, Any]:
        proposed = self.ledger.latest_payload(action_id, "action_proposed")
        if not proposed:
            raise KeyError(action_id)
        return proposed["action"]

    def preview_action(self, action_id: str) -> dict[str, Any]:
        action = self.action(action_id)
        target = self.targets.get(action["adapter"])
        if not target or not getattr(target, "writable", False):
            raise ValueError("action does not reference a writable sandbox adapter")
        preview = target.preview(action)
        decision = self.policy.decide(action)
        result = {"action_id": action_id, "preview": preview, "authorization": decision}
        self.ledger.append("action_previewed", action_id, result)
        return result

    def execute_action(self, action_id: str, confirmation_id: str | None = None) -> dict[str, Any]:
        action = self.action(action_id)
        target = self.targets.get(action["adapter"])
        if not target or not getattr(target, "writable", False):
            raise ValueError("action does not reference a writable sandbox adapter")
        before = target.observe(action)
        preview = target.preview(action)
        decision = self.policy.decide(action, confirmation_id=confirmation_id)
        base = {"action_id": action_id, "before": before, "preview": preview, "authorization": decision}
        if decision["decision"] != "allow":
            result = {**base, "status": "blocked", "validation": None, "rollback": None}
            self.ledger.append("action_execution", action_id, result)
            return result
        if not self.ledger.claim_idempotency(action["idempotency_key"], action_id):
            previous = self.ledger.latest_payload(action_id, "action_execution")
            return {"action_id": action_id, "status": "duplicate", "previous": previous}
        applied = target.apply(action)
        validation = target.verify(action)
        rollback = None
        status = "succeeded"
        if not validation["valid"]:
            rollback = target.rollback(action, before)
            status = "rolled-back" if rollback["succeeded"] else "rollback-failed"
        result = {
            **base,
            "status": status,
            "applied": applied,
            "after": target.observe(action),
            "validation": validation,
            "rollback": rollback,
            "completed_at": utc_now(),
        }
        self.ledger.append("action_execution", action_id, result)
        return result

    def local_status(self) -> dict[str, Any]:
        return self.targets["status"].status()

    def atlas_status(self) -> dict[str, Any]:
        result = self.targets["jarvis-status"].status()
        self.ledger.append("status_observation", "atlas", result)
        return result

    def jarvis_status(self) -> dict[str, Any]:
        """Compatibility alias for integrations not yet moved to Atlas naming."""
        return self.atlas_status()

    def cyber_status(self) -> dict[str, Any]:
        # Read a collector snapshot only: page views never launch OS queries or AI.
        return read_snapshot(self.settings.data_dir / "cyber-health.json")

    def energy_status(self) -> dict[str, Any]:
        from .charging_records import read_charging_records
        result = self.targets["powerwall-status"].status()
        references = read_charging_records(self.settings.data_dir / "charging-records.json")
        if references["status"] != "not_imported":
            charge = result.get("vehicle_charge_snapshot") or {"status": "references_only", "automatic_collection": False, "commands_enabled": False}
            charge.update(records=references["records"], references_status=references["status"])
            result["vehicle_charge_snapshot"] = charge
        return result

    def energy_forecast(self) -> dict[str, Any]:
        return self.targets["powerwall-status"].forecast()

    def energy_history(self, range_name: str) -> dict[str, Any]:
        return self.targets["powerwall-status"].history(range_name)

    def energy_calendar(self, period: str, date_text: str) -> dict[str, Any]:
        return self.energy_store.calendar(self.targets["powerwall-status"].calendar_source, period, date_text)

    def home_status(self) -> dict[str, Any]:
        return self.targets["home-status"].status()

    def home_environment_history(self) -> dict[str, Any]:
        return self.targets["home-status"].environment_history()

    def home_inventory(self) -> dict[str, Any]:
        return self.targets["home-inventory"].status()

    def set_home_control(self, entity_id: Any, enabled: Any, client_address: str) -> dict[str, Any]:
        result = self.targets["home-inventory"].set_control(entity_id, enabled)
        self.ledger.append("household_control", str(entity_id), {"operation": "set_control", "enabled": enabled, "client_address": client_address, "completed_at": utc_now()})
        return result

    def household_status(self, profile_id: str) -> dict[str, Any]:
        return self.targets["household"].status(profile_id)

    def set_household_profile_pin(self, profile_id: Any, pin: Any) -> dict[str, Any]:
        return self.targets["household"].set_pin(profile_id, pin)

    def switch_household_profile(self, profile_id: Any, pin: Any = None) -> dict[str, Any]:
        return self.targets["household"].switch_profile(profile_id, pin)

    def send_household_message(self, sender: Any, recipient: Any, body: Any) -> dict[str, Any]:
        result = self.targets["household"].send(sender, recipient, body)
        self.ledger.append("household_message", str(result["message_id"]), {"sender": sender, "recipient": recipient, "created_at": result["created_at"]})
        return result

    def mark_household_message_read(self, message_id: Any, profile: Any) -> dict[str, Any]:
        return self.targets["household"].mark_read(message_id, profile)

    def delete_household_message(self, message_id: Any, profile: Any) -> dict[str, Any]:
        return self.targets["household"].delete(message_id, profile)

    def vacation_ids_status(self) -> dict[str, Any]:
        return self.targets["vacation-ids"].status()

    def set_vacation_ids(self, armed: Any, confirmation: Any, client_address: str) -> dict[str, Any]:
        result = self.targets["vacation-ids"].set_armed(armed, confirmation, client_address)
        self.ledger.append(
            "household_control",
            "vacation-ids",
            {
                "operation": "arm" if armed else "disarm",
                "client_address": client_address,
                "completed_at": utc_now(),
            },
        )
        return result

    def galleyquest_status(self) -> dict[str, Any]:
        return self.targets["galleyquest-status"].status()

    def travel_status(self) -> dict[str, Any]:
        return self.targets["travel"].status()

    def argo_status(self) -> dict[str, Any]:
        return self.assets.status()

    def confirm_travel_review(self, body: dict[str, Any]) -> dict[str, Any]:
        from .travel_store import TravelStore
        result = TravelStore(self.targets["travel"].path).confirm_review(body)
        return {"status": result["status"], "update_id": result["update_id"], "travel": self.travel_status()}

    def set_home_temperature(self, temperature: Any, client_address: str) -> dict[str, Any]:
        result = self.targets["home-status"].set_temperature(temperature)
        self.ledger.append(
            "household_control",
            "home-hvac",
            {
                "operation": "set_temperature",
                "target_temperature": result["target_temperature"],
                "client_address": client_address,
                "completed_at": utc_now(),
            },
        )
        return result
