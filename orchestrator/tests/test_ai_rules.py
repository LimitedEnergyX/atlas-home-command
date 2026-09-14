from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from atlas_orchestrator.ai_rules import AI_RULES_SHA256, CANONICAL_RULES_PATH, PACKAGED_RULES_PATH, load_ai_rules
from atlas_orchestrator.config import Settings
from atlas_orchestrator.core import AtlasOrchestrator
from atlas_orchestrator.providers import AnthropicProvider, OllamaProvider, OpenAIProvider, XAIProvider
from atlas_orchestrator.providers.base import ATLAS_CHAT_OUTPUT_SCHEMA, ATLAS_OUTPUT_SCHEMA, provider_instructions
from atlas_orchestrator.providers.ollama import OLLAMA_CONTEXT_TOKENS


class AIRulesTests(unittest.TestCase):
    def test_canonical_packaged_hash_and_complete_text_match(self):
        canonical = CANONICAL_RULES_PATH.read_bytes()
        self.assertEqual(hashlib.sha256(canonical).hexdigest(), AI_RULES_SHA256)
        self.assertEqual(PACKAGED_RULES_PATH.read_bytes(), canonical)
        self.assertEqual(load_ai_rules(), canonical.decode("utf-8"))

    def test_all_provider_payloads_contain_full_charter_once_for_chat_and_analysis(self):
        rules = load_ai_rules()
        answer = json.dumps({"recommendation": "Ready.", "reasoning_summary": "Brief answer.", "assumptions": [], "risks": [], "confidence": 0.9, "proposed_actions": []})
        for cls, module, response in (
            (OllamaProvider, "ollama", {"message": {"content": answer}}),
            (OpenAIProvider, "openai", {"output_text": answer}),
            (XAIProvider, "openai", {"output_text": answer}),
            (AnthropicProvider, "anthropic", {"content": [{"type": "text", "text": answer}]}),
        ):
            for surface in ("chat", "analysis"):
                with self.subTest(provider=cls.__name__, surface=surface):
                    provider = cls()
                    provider.model = "test-model"
                    provider.api_key = "test-only"
                    request = {"intent": "Reply briefly with Ready.", "task_surface": surface}
                    with patch.object(provider, "available", return_value=(True, None)), patch(f"atlas_orchestrator.providers.{module}.post_json", return_value=response) as posted:
                        result = provider.generate(request, 1.0)
                    payload = posted.call_args.args[1]
                    instruction = payload.get("instructions") or payload.get("system") or payload["messages"][0]["content"]
                    self.assertEqual(instruction.count(rules), 1)
                    self.assertTrue(instruction.startswith(rules))
                    self.assertIn("Return only a JSON object", instruction)
                    self.assertEqual("Hermes" in instruction, surface == "chat")
                    self.assertEqual(result["recommendation"], "Ready.")
                    if cls is OllamaProvider:
                        self.assertEqual(payload["format"], ATLAS_CHAT_OUTPUT_SCHEMA if surface == "chat" else ATLAS_OUTPUT_SCHEMA)
                        self.assertEqual(payload["options"]["num_ctx"], OLLAMA_CONTEXT_TOKENS)
                        self.assertFalse(payload["think"])
                        self.assertEqual(payload["options"]["num_predict"], 512)

    def test_missing_rules_block_ai_but_not_health_or_manual_route_methods(self):
        with tempfile.TemporaryDirectory() as folder:
            app = AtlasOrchestrator(Settings(data_dir=Path(folder)))
            missing = Path(folder) / "missing.md"
            with patch("atlas_orchestrator.ai_rules.PACKAGED_RULES_PATH", missing):
                with self.assertRaisesRegex(RuntimeError, "required AI_RULES.md"):
                    app.chat({"message": "hello"})
                with self.assertRaisesRegex(RuntimeError, "required AI_RULES.md"):
                    app.orchestrate({"intent": "hello"})
                with patch.object(app, "providers", {}):
                    self.assertTrue(app.health()["ledger"]["healthy"])
                with patch.object(app.targets["home-status"], "status", return_value={"status": "healthy"}):
                    self.assertEqual(app.home_status()["status"], "healthy")
                with patch.object(app.targets["home-inventory"], "set_control", return_value={"status": "accepted"}) as control:
                    self.assertEqual(app.set_home_control("light.test", True, "127.0.0.1")["status"], "accepted")
                    control.assert_called_once_with("light.test", True)

    def test_installed_package_loads_without_a_source_checkout(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch("atlas_orchestrator.ai_rules.SOURCE_ROOT", Path(folder)), patch("atlas_orchestrator.ai_rules.CANONICAL_RULES_PATH", Path(folder) / "AI_RULES.md"):
                self.assertEqual(load_ai_rules(), PACKAGED_RULES_PATH.read_text(encoding="utf-8"))

    def test_corrupt_and_missing_canonical_cannot_fall_back_to_unruled_prompt(self):
        with patch("atlas_orchestrator.ai_rules.Path.read_bytes", return_value=b"incomplete"):
            with self.assertRaisesRegex(RuntimeError, "approved charter"):
                provider_instructions({"task_surface": "chat"})
        with tempfile.TemporaryDirectory() as folder:
            with patch("atlas_orchestrator.ai_rules.CANONICAL_RULES_PATH", Path(folder) / "missing.md"):
                with self.assertRaisesRegex(RuntimeError, "required AI_RULES.md"):
                    load_ai_rules()

    def test_oversized_local_context_is_rejected_before_network_not_truncated(self):
        provider = OllamaProvider()
        provider.model = "test-model"
        with patch.object(provider, "available", return_value=(True, None)), patch("atlas_orchestrator.providers.ollama.post_json") as posted:
            with self.assertRaisesRegex(ValueError, "rules were not truncated"):
                provider.generate({"intent": "x" * 20000}, 1.0)
        posted.assert_not_called()

    def test_evidence_contract_does_not_let_requested_wording_override_unknown_state(self):
        for surface in ("chat", "analysis"):
            instructions = provider_instructions({"task_surface": surface})
            self.assertIn("Requested wording is not evidence", instructions)
            self.assertIn("unknown, not success or safety", instructions)
            self.assertIn("synthetic test", instructions)
        chat = provider_instructions({"task_surface": "chat"})
        self.assertIn("Never claim a command is done or a device is in a known state during planning", chat)
        self.assertIn("You must NOT execute tools yourself during this planning call", chat)
        self.assertIn("A service accepting a", chat)
        self.assertIn("command is not proof", chat)


if __name__ == "__main__":
    unittest.main()
