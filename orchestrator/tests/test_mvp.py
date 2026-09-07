from __future__ import annotations

import json
import io
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.api import AtlasHTTPServer  # noqa: E402
from atlas_orchestrator.config import Settings  # noqa: E402
from atlas_orchestrator.core import AtlasOrchestrator  # noqa: E402
from atlas_orchestrator.ledger import Ledger  # noqa: E402
from atlas_orchestrator.providers import (  # noqa: E402
    AnthropicProvider,
    FakeProvider,
    OpenAIProvider,
    OllamaProvider,
    ProviderAdapter,
    XAIProvider,
)
from atlas_orchestrator.redaction import Redactor  # noqa: E402
from atlas_orchestrator.schemas import normalized_provider_output, validate_request  # noqa: E402


class MVPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def core(self, providers=None, retry_budget=0) -> AtlasOrchestrator:
        return AtlasOrchestrator(Settings(self.data_dir, retry_budget=retry_budget), providers)

    @staticmethod
    def request(**overrides):
        request = {
            "intent": "Evaluate a sandbox option",
            "provider_policy": "compare",
            "providers": ["one", "two", "three"],
            "deadline_ms": 1000,
        }
        request.update(overrides)
        return request

    @staticmethod
    def action(action_class="routine-reversible", **overrides):
        action = {
            "adapter": "mock",
            "operation": "set",
            "target": "sandbox/example",
            "parameters": {"key": "example", "value": 42},
            "action_class": action_class,
            "authority_basis": "operator-approved MVP sandbox",
            "idempotency_key": f"test-{time.time_ns()}",
        }
        action.update(overrides)
        return action

    def test_01_all_fake_adapters_normalize(self):
        providers = {name: FakeProvider(name) for name in ("one", "two", "three")}
        result = self.core(providers).orchestrate(self.request())
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(result["responses"]), 3)
        for response in result["responses"]:
            self.assertEqual(response["status"], "success")
            self.assertIsInstance(response["recommendation"], str)
            self.assertGreaterEqual(response["confidence"], 0)
            self.assertIn("usage", response)

    def test_02_real_adapters_share_interface(self):
        for adapter in (OpenAIProvider(), AnthropicProvider(), XAIProvider(), OllamaProvider()):
            self.assertIsInstance(adapter, ProviderAdapter)
            available, reason = adapter.available()
            self.assertIsInstance(available, bool)
            if not available:
                self.assertIsInstance(reason, str)

    def test_03_failure_and_malformed_are_isolated(self):
        providers = {
            "one": FakeProvider("one", mode="failure"),
            "two": FakeProvider("two", mode="malformed"),
            "three": FakeProvider("three"),
        }
        result = self.core(providers).orchestrate(self.request())
        self.assertEqual(result["status"], "completed")
        self.assertEqual([item["status"] for item in result["responses"]], ["error", "error", "success"])

        fallback = self.core(providers).orchestrate(
            self.request(provider_policy="fallback", providers=["one", "three"])
        )
        self.assertEqual([item["status"] for item in fallback["responses"]], ["error", "success"])

    def test_04_total_outage_is_bounded_and_denies_action(self):
        providers = {
            "one": FakeProvider("one", delay_seconds=0.3),
            "two": FakeProvider("two", mode="failure"),
        }
        started = time.monotonic()
        result = self.core(providers).orchestrate(
            self.request(providers=["one", "two"], deadline_ms=100, requested_action=self.action())
        )
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["action"]["authorization"]["decision"], "deny")

    def test_05_consensus_cannot_change_material_denial(self):
        providers = {
            "one": FakeProvider("one", confidence=1.0),
            "two": FakeProvider("two", confidence=1.0),
            "three": FakeProvider("three", confidence=1.0),
        }
        result = self.core(providers).orchestrate(
            self.request(requested_action=self.action("material"))
        )
        self.assertTrue(all(item["confidence"] == 1.0 for item in result["responses"]))
        self.assertEqual(result["action"]["authorization"]["decision"], "deny")

    def _propose(self, core: AtlasOrchestrator, action: dict) -> str:
        result = core.orchestrate(
            {
                "intent": "Propose sandbox write",
                "provider_policy": "local-only",
                "providers": ["fake-openai"],
                "requested_action": action,
            }
        )
        return result["action"]["action_id"]

    def test_06_routine_write_observes_authorizes_applies_and_verifies(self):
        core = self.core()
        action_id = self._propose(core, self.action())
        preview = core.preview_action(action_id)
        self.assertFalse(preview["preview"]["before"]["exists"])
        self.assertEqual(preview["authorization"]["decision"], "allow")
        result = core.execute_action(action_id)
        self.assertEqual(result["status"], "succeeded")
        self.assertTrue(result["validation"]["valid"])
        self.assertEqual(result["after"]["value"], 42)

    def test_07_controlled_action_requires_confirmation(self):
        core = self.core()
        action_id = self._propose(core, self.action("controlled-change"))
        blocked = core.execute_action(action_id)
        self.assertEqual(blocked["status"], "blocked")
        self.assertEqual(blocked["authorization"]["decision"], "confirmation-required")
        allowed = core.execute_action(action_id, "operator-confirmation-test")
        self.assertEqual(allowed["status"], "succeeded")

    def test_08_material_action_is_never_executed(self):
        core = self.core()
        action_id = self._propose(core, self.action("material"))
        result = core.execute_action(action_id, "confirmation-cannot-override-policy")
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["authorization"]["decision"], "deny")

    def test_09_idempotency_prevents_duplicate_side_effect(self):
        core = self.core()
        action_id = self._propose(core, self.action())
        first = core.execute_action(action_id)
        second = core.execute_action(action_id)
        self.assertEqual(first["status"], "succeeded")
        self.assertEqual(second["status"], "duplicate")

    def test_10_verification_failure_rolls_back(self):
        core = self.core()
        action = self.action(parameters={"key": "rollback", "value": "bad", "simulate_verify_failure": True})
        action_id = self._propose(core, action)
        result = core.execute_action(action_id)
        self.assertEqual(result["status"], "rolled-back")
        self.assertTrue(result["rollback"]["succeeded"])
        self.assertFalse(result["after"]["exists"])

    def test_11_ledger_redacts_secret_keys_values_and_bearer_tokens(self):
        ledger = Ledger(self.data_dir / "redaction.sqlite3", Redactor(["literal-secret-value"]))
        ledger.append(
            "test",
            "redact",
            {
                "api_key": "never-store-me",
                "message": "literal-secret-value and Bearer abc.def.ghi",
            },
        )
        serialized = json.dumps(ledger.events("redact"))
        self.assertNotIn("never-store-me", serialized)
        self.assertNotIn("literal-secret-value", serialized)
        self.assertNotIn("abc.def.ghi", serialized)
        self.assertIn("[REDACTED]", serialized)

    def test_12_evidence_is_durably_recorded(self):
        providers = {"fake-openai": FakeProvider("fake-openai")}
        core = self.core(providers)
        action_id = self._propose(core, self.action())
        core.execute_action(action_id)
        provider_events = core.ledger.provider_events(
            core.ledger.latest_payload(action_id, "action_proposed")["request_id"]
        )
        self.assertEqual(len(provider_events), 1)
        provider = provider_events[0]["payload"]
        for field in ("usage", "latency_ms", "estimated_cost", "error"):
            self.assertIn(field, provider)
        execution = core.ledger.latest_payload(action_id, "action_execution")
        self.assertIn("authorization", execution)
        self.assertEqual(execution["authorization"]["decision"], "allow")
        self.assertIn("validation", execution)

    def test_13_restart_recovers_requests_and_completed_records(self):
        core = self.core()
        result = core.orchestrate(
            {"intent": "Persist this", "provider_policy": "local-only", "providers": ["fake-openai"]}
        )
        restarted = self.core()
        record = restarted.request_record(result["request_id"])
        self.assertIsNotNone(record)
        self.assertEqual(record["latest"]["status"], "completed")

    def test_14_health_degrades_provider_without_service_failure(self):
        providers = {
            "good": FakeProvider("good"),
            "bad": FakeProvider("bad", mode="unavailable"),
        }
        health = self.core(providers).health()
        self.assertEqual(health["status"], "healthy")
        self.assertTrue(health["providers"]["good"]["available"])
        self.assertFalse(health["providers"]["bad"]["available"])

    def test_compare_calls_independent_providers_concurrently(self):
        barrier = threading.Barrier(3)

        class BarrierProvider(FakeProvider):
            def generate(self, request, timeout_seconds):
                barrier.wait(timeout=1.0)
                return super().generate(request, timeout_seconds)

        providers = {
            name: BarrierProvider(name)
            for name in ("one", "two", "three")
        }
        result = self.core(providers).orchestrate(self.request(deadline_ms=1000))
        self.assertEqual(result["status"], "completed")
        self.assertEqual([item["status"] for item in result["responses"]], ["success"] * 3)

    def test_local_only_rejects_real_provider_name(self):
        providers = {"openai": OpenAIProvider()}
        with self.assertRaisesRegex(ValueError, "local-only"):
            self.core(providers).orchestrate(
                {"intent": "Do not egress", "provider_policy": "local-only", "providers": ["openai"]}
            )

    def test_cloud_provider_requires_explicit_spend_authority_before_call(self):
        class CloudProvider(FakeProvider):
            is_local = False
            provider_kind = "cloud-model"

        cloud = CloudProvider("cloud")
        with self.assertRaisesRegex(ValueError, "positive spend_limit"):
            self.core({"cloud": cloud}).orchestrate(
                {"intent": "Cloud analysis", "provider_policy": "single", "providers": ["cloud"]}
            )
        self.assertEqual(cloud.calls, 0)

    def test_request_rejects_invalid_spend_limit_values(self):
        self.assertEqual(validate_request({"intent": "Use the bounded default"})["deadline_ms"], 90_000)
        for value in (-0.01, float("nan"), float("inf"), "1.00", True):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "spend_limit"):
                validate_request({"intent": "Validate budget", "spend_limit": value})

    def test_normalized_output_requires_proposed_actions_array(self):
        value = {
            "recommendation": "Proceed locally.",
            "reasoning_summary": "No cloud call is needed.",
            "assumptions": [],
            "risks": [],
            "confidence": 0.9,
        }
        with self.assertRaisesRegex(ValueError, "proposed_actions"):
            normalized_provider_output(value)
        value["proposed_actions"] = "not-an-array"
        with self.assertRaisesRegex(ValueError, "proposed_actions must be an array"):
            normalized_provider_output(value)

    def test_ollama_adapter_uses_structured_local_chat_contract(self):
        provider = OllamaProvider()
        provider.model = "test-local-model"
        response = {
            "message": {
                "content": json.dumps(
                    {
                        "recommendation": "Use the local route.",
                        "reasoning_summary": "The request is private.",
                        "assumptions": [],
                        "risks": ["Local model quality varies."],
                        "confidence": 0.7,
                        "proposed_actions": [],
                    }
                )
            },
            "prompt_eval_count": 11,
            "eval_count": 7,
        }
        with patch.object(provider, "available", return_value=(True, None)), patch(
            "atlas_orchestrator.providers.ollama.post_json", return_value=response
        ) as posted:
            result = provider.generate(self.request(), 1.0)
        payload = posted.call_args.args[1]
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["keep_alive"], "10m")
        self.assertEqual(payload["format"]["type"], "object")
        self.assertEqual(result["usage"]["total_tokens"], 18)

    def test_ollama_chat_contract_requires_a_direct_hermes_answer(self):
        provider = OllamaProvider()
        provider.model = "test-local-model"
        response = {
            "message": {
                "content": json.dumps(
                    {
                        "recommendation": "I can help with that.",
                        "reasoning_summary": "Direct response prepared.",
                        "assumptions": [],
                        "risks": [],
                        "confidence": 0.9,
                        "proposed_actions": [],
                    }
                )
            }
        }
        request = self.request()
        request["task_surface"] = "chat"
        with patch.object(provider, "available", return_value=(True, None)), patch(
            "atlas_orchestrator.providers.ollama.post_json", return_value=response
        ) as posted:
            provider.generate(request, 1.0)
        system_prompt = posted.call_args.args[1]["messages"][0]["content"]
        self.assertIn("Hermes", system_prompt)
        self.assertIn("actual answer shown to the user", system_prompt)

    def test_openai_adapter_uses_responses_structured_output_contract(self):
        provider = OpenAIProvider()
        provider.api_key = "test-key"
        provider.model = "test-model"
        response = {
            "output_text": json.dumps(
                {
                    "recommendation": "Use the bounded route.",
                    "reasoning_summary": "The request was evaluated.",
                    "assumptions": [],
                    "risks": [],
                    "confidence": 0.8,
                    "proposed_actions": [],
                }
            ),
            "usage": {"input_tokens": 5, "output_tokens": 6, "total_tokens": 11},
        }
        with patch("atlas_orchestrator.providers.openai.post_json", return_value=response) as posted:
            result = provider.generate(self.request(), 1.0)
        payload = posted.call_args.args[1]
        self.assertFalse(payload["store"])
        self.assertEqual(payload["text"]["format"]["type"], "json_schema")
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertEqual(result["usage"]["total_tokens"], 11)

    def test_anthropic_adapter_uses_messages_structured_output_contract(self):
        provider = AnthropicProvider()
        provider.api_key = "test-key"
        provider.model = "test-model"
        response = {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "recommendation": "Use the bounded route.",
                            "reasoning_summary": "The request was evaluated.",
                            "assumptions": [],
                            "risks": [],
                            "confidence": 0.8,
                            "proposed_actions": [],
                        }
                    ),
                }
            ],
            "usage": {"input_tokens": 5, "output_tokens": 6},
        }
        with patch("atlas_orchestrator.providers.anthropic.post_json", return_value=response) as posted:
            result = provider.generate(self.request(), 1.0)
        payload = posted.call_args.args[1]
        self.assertEqual(payload["output_config"]["format"]["type"], "json_schema")
        schema = payload["output_config"]["format"]["schema"]
        self.assertFalse(schema["additionalProperties"])
        self.assertNotIn("minimum", schema["properties"]["confidence"])
        self.assertNotIn("maximum", schema["properties"]["confidence"])
        self.assertEqual(result["usage"]["total_tokens"], 11)

    def test_xai_adapter_uses_responses_structured_output_contract(self):
        provider = XAIProvider()
        provider.api_key = "test-key"
        provider.model = "test-model"
        response = {
            "output_text": json.dumps(
                {
                    "recommendation": "Use the independent review.",
                    "reasoning_summary": "The request was evaluated.",
                    "assumptions": [],
                    "risks": [],
                    "confidence": 0.75,
                    "proposed_actions": [],
                }
            ),
            "usage": {"input_tokens": 7, "output_tokens": 8, "total_tokens": 15},
        }
        with patch("atlas_orchestrator.providers.openai.post_json", return_value=response) as posted:
            result = provider.generate(self.request(), 1.0)
        payload = posted.call_args.args[1]
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertFalse(payload["store"])
        self.assertEqual(result["usage"]["total_tokens"], 15)

    def test_auto_private_request_uses_only_available_local_provider(self):
        class LocalProvider(ProviderAdapter):
            name = "local"
            model = "local-test"
            is_local = True
            provider_kind = "local-model"

            def available(self):
                return True, None

            def generate(self, request, timeout_seconds):
                return FakeProvider("local-result").generate(request, timeout_seconds)

        class CloudProvider(ProviderAdapter):
            name = "cloud"
            model = "cloud-test"
            is_local = False
            provider_kind = "cloud-model"

            def __init__(self):
                self.calls = 0

            def available(self):
                return True, None

            def generate(self, request, timeout_seconds):
                self.calls += 1
                raise AssertionError("private requests must not call a cloud provider")

        cloud = CloudProvider()
        result = self.core({"local": LocalProvider(), "cloud": cloud}).orchestrate(
            {
                "intent": "Analyze private household context",
                "provider_policy": "auto",
                "privacy_class": "private",
            }
        )
        self.assertEqual(result["effective_provider_policy"], "local-only")
        self.assertEqual(result["routing"]["providers"], ["local"])
        self.assertTrue(result["routing"]["local_only"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(cloud.calls, 0)

    def test_auto_routine_falls_back_and_complex_compares(self):
        providers = {
            "one": FakeProvider("one", mode="failure"),
            "two": FakeProvider("two"),
            "three": FakeProvider("three"),
        }
        routine = self.core(providers).orchestrate(
            self.request(provider_policy="auto", task_class="routine")
        )
        self.assertEqual(routine["effective_provider_policy"], "fallback")
        self.assertEqual([item["provider"] for item in routine["responses"]], ["one", "two"])
        complex_result = self.core(providers).orchestrate(
            self.request(provider_policy="auto", task_class="planning")
        )
        self.assertEqual(complex_result["effective_provider_policy"], "compare")
        self.assertEqual(len(complex_result["responses"]), 3)

    def test_comparison_is_evidence_only_and_cannot_grant_authority(self):
        providers = {"one": FakeProvider("one"), "two": FakeProvider("two")}
        result = self.core(providers).orchestrate(
            self.request(
                providers=["one", "two"],
                requested_action=self.action("material"),
            )
        )
        self.assertEqual(result["comparison"]["review_level"], "multi-source")
        self.assertEqual(result["comparison"]["authority_effect"], "none")
        self.assertEqual(result["action"]["authorization"]["decision"], "deny")

    def test_provider_health_reports_locality_without_credentials(self):
        health = self.core({"local": FakeProvider("local")}).health()
        self.assertTrue(health["providers"]["local"]["local"])
        self.assertEqual(health["providers"]["local"]["kind"], "deterministic-sandbox")
        self.assertNotIn("api_key", json.dumps(health))

    def test_native_chat_routes_locally_and_only_recommends_escalation(self):
        local = FakeProvider("ollama", confidence=0.82)
        result = self.core({"ollama": local}).chat(
            {"message": "Plan a resilient household notification strategy", "mode": "auto"}
        )
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["route"]["provider"], "ollama")
        self.assertTrue(result["route"]["local_only"])
        self.assertTrue(result["route"]["escalation_recommended"])
        self.assertEqual(result["assistant"]["name"], "Hermes")
        self.assertEqual(local.calls, 1)

    def test_native_chat_never_starts_cloud_review_without_positive_budget(self):
        with self.assertRaisesRegex(ValueError, "positive spend_limit"):
            self.core({"ollama": FakeProvider("ollama")}).chat(
                {"message": "Review this plan", "mode": "review"}
            )


class APITests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        core = AtlasOrchestrator(Settings(Path(self.temporary.name), retry_budget=0))
        self.server = AtlasHTTPServer(("127.0.0.1", 0), core)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, method: str, path: str, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.status, json.loads(response.read())

    def test_health_and_request_round_trip(self):
        status, liveness = self.request("GET", "/live")
        self.assertEqual(status, 200)
        self.assertEqual(liveness, {"status": "alive"})
        status, health = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["status"], "healthy")
        status, result = self.request(
            "POST",
            "/v1/orchestrate",
            {"intent": "API smoke", "provider_policy": "local-only"},
        )
        self.assertEqual(status, 200)
        status, record = self.request("GET", f"/v1/requests/{result['request_id']}")
        self.assertEqual(status, 200)
        self.assertEqual(record["request_id"], result["request_id"])

    def test_native_chat_is_available_to_same_origin_household_clients(self):
        self.server.orchestrator.providers = {"ollama": FakeProvider("ollama", confidence=0.8)}
        status, result = self.request(
            "POST", "/v1/chat", {"message": "What should I check first?", "mode": "auto"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["route"]["provider"], "ollama")
        self.assertTrue(result["route"]["local_only"])

    def test_galleyquest_status_route_is_fail_soft_when_not_configured(self):
        status, result = self.request("GET", "/v1/galleyquest/status")
        self.assertEqual(status, 200)
        self.assertEqual(result["adapter"], "galleyquest-status")
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "not_configured")

    def test_invalid_request_returns_400(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request("POST", "/v1/orchestrate", {"intent": ""})
        self.assertEqual(raised.exception.code, 400)

    def test_action_preview_and_execute_routes(self):
        action = {
            "adapter": "mock",
            "operation": "set",
            "target": "sandbox/api",
            "parameters": {"key": "api", "value": "verified"},
            "action_class": "routine-reversible",
            "authority_basis": "API test",
            "idempotency_key": "api-action-test",
        }
        _, proposed = self.request(
            "POST",
            "/v1/orchestrate",
            {
                "intent": "Propose API mock write",
                "provider_policy": "local-only",
                "requested_action": action,
            },
        )
        action_id = proposed["action"]["action_id"]
        _, preview = self.request("POST", f"/v1/actions/{action_id}/preview", {})
        self.assertEqual(preview["authorization"]["decision"], "allow")
        _, executed = self.request("POST", f"/v1/actions/{action_id}/execute", {})
        self.assertEqual(executed["status"], "succeeded")

    def test_native_household_controls_do_not_require_home_assistant_login(self):
        class HomeControlStub:
            def set_temperature(self, temperature):
                return {
                    "status": "accepted",
                    "target_temperature": float(temperature),
                    "snapshot": {"status": "healthy"},
                }


        target = HomeControlStub()
        self.server.orchestrator.targets["home-status"] = target
        status, result = self.request("POST", "/v1/home/hvac", {"temperature": 72})
        self.assertEqual(status, 200)
        self.assertEqual(result["target_temperature"], 72)
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(urllib.request.Request(self.base + "/v1/home/cameras/driveway/image"), timeout=2)
        self.assertEqual(raised.exception.code, 404)


    def test_household_control_rejects_cross_origin_browser_post(self):
        request = urllib.request.Request(
            self.base + "/v1/home/hvac",
            # Exercise the header-level origin guard without an unread body
            # racing the early connection close on Windows.
            data=b"",
            method="POST",
            headers={"Content-Type": "application/json", "Origin": "http://untrusted.example"},
        )
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(raised.exception.code, 403)

    def test_server_trusts_only_configured_client_networks(self):
        self.assertTrue(self.server.client_is_trusted("127.0.0.1"))
        self.assertFalse(self.server.client_is_trusted("192.0.2.25"))
        core = AtlasOrchestrator(Settings(Path(self.temporary.name), retry_budget=0))
        server = AtlasHTTPServer(
            ("127.0.0.1", 0),
            core,
            trusted_networks=("127.0.0.0/8", "192.0.2.0/24", "100.64.50.10/10"),
        )
        try:
            self.assertTrue(server.client_is_trusted("192.0.2.25"))
            self.assertTrue(server.client_is_trusted("100.64.50.10"))
            self.assertFalse(server.client_is_trusted("172.22.112.1"))
            self.assertTrue(server.client_can_write("127.0.0.1"))
            self.assertFalse(server.client_can_write("192.0.2.25"))
            self.assertFalse(server.client_can_write("100.64.50.10"))
        finally:
            server.server_close()


if __name__ == "__main__":
    unittest.main()
