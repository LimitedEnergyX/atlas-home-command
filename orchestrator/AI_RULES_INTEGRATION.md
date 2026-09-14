# Atlas AI rules integration

The authoritative charter is `<atlas-source-root>/AI_RULES.md`. Its complete text is
included verbatim once in the system instructions for each real model request.
The shared `providers.base.provider_instructions` path covers Ollama, OpenAI,
Anthropic, and xAI, including the dedicated Hermes chat page and any client using
the same Atlas chat endpoint. The existing identity and JSON response contract
follow the charter. No device permissions, tools, endpoints, cloud routing,
spending approvals, or manual controls are changed by this integration.

`src/atlas_orchestrator/AI_RULES.md` is a byte-identical package resource so wheel
installs retain the rules. `ai_rules.py` verifies SHA-256 on every AI request. In
a source checkout it also verifies the canonical root file. Missing, unreadable,
or drifted rules stop AI requests with a clear error, never an unruled fallback.
The rules are not loaded at application startup or by manual-control routes.

Approved charter SHA-256:
`7d2b000b6ad0a338b5c696a746c8ed91b1986406be3f0dd9709860703dc4fcb5`.

To intentionally revise the charter, review the full canonical change, synchronize
the package copy exactly, update the approved hash, and rerun the regression
tests. Do not change the hash merely to bypass a mismatch. Setuptools includes
the resource in the installed package.

Ollama requests explicitly use a 16,384-token context instead of inheriting the
server's smaller default. A conservative UTF-8 byte bound reserves 1,024 tokens
for message framing and the existing 512-token answer allowance. Oversized
requests fail before inference with instructions to shorten the conversation;
the charter is never shortened. This is a conservative safety bound, not a
measurement of the model's actual tokenizer. The larger context's GPU residency,
latency, and response quality require a real runtime check during coordinated
deployment. No model name is changed here.

Tests capture the actual mocked outgoing HTTP payload for all four adapters,
verify full-text inclusion and hashes, retain Hermes identity and schema, check
short-response parsing, reject oversized requests, test installed-resource
loading, and verify missing rules do not disable mocked manual controls or health.
These tests do not prove model obedience or physical-device operation.
