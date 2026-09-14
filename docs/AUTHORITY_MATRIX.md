# Atlas Orchestrator — Action Authority Matrix

**Status:** Approved by operator for the local sandbox
**Date:** 2026-08-19  
**Decision lens:** `ATLAS_MISSION.md`  
**Architecture contract:** `ATLAS_ARCHITECTURE.md`

## 1. Controlling rules

The human operators remain the highest authority. A model recommendation, confidence score, provider majority, successful command, or HTTP response never creates permission.

Authority is evaluated for the exact action, target, scope, consequence, and current delegation. Every write follows: observe, propose, authorize, apply, verify, record. Where the target supports it, the Orchestrator also records and tests rollback or recovery.

Standing delegation must be explicit, narrowly scoped, revocable, and bounded by target, operation, limits, and optional expiry. The Orchestrator must never infer a standing delegation from prior approvals.

Secrets are supplied to adapters by the runtime. They are not included in model prompts, action logs, or provider responses.

## 2. Action matrix

| Domain and action | Class | May execute without a new confirmation? | Required evidence and boundary |
| --- | --- | --- | --- |
| Read household status, logs, configuration, or history | `routine-reversible` | Yes, within granted read scope | Record source and freshness; redact secrets and sensitive values |
| Create or adjust a dashboard layout or visualization | `routine-reversible` | Yes, when version history or rollback exists | Capture current version; verify rendered panel and data freshness |
| Change a personal notification preference | `routine-reversible` | Yes, within a standing delegation | Verify the actual route and preserve prior preference |
| Update GalleyQuest pantry quantities, item metadata, meal plans, or grocery lists | `routine-reversible` | Yes, within household delegation | Validate item identity; record before/after values; support correction |
| Prepare a retailer cart without submitting it | `controlled-change` | Only under a narrow retailer/cart delegation | Verify items, substitutions, quantities, price estimate, fees, and fulfillment details |
| Submit, change, or cancel a grocery order | `material` | No | Exact confirmation of retailer, items, substitutions, final total/fees, fulfillment method, and time window immediately before submission |
| Create or modify a non-safety Home Assistant automation | `controlled-change` | Only under a narrow standing delegation | Show diff; validate syntax; dry-run where possible; verify trigger and resulting state; preserve rollback |
| Change HVAC, lighting, irrigation, or other reversible device state within agreed bounds | `routine-reversible` | Yes, only inside explicit device/range/time delegation | Read state before and after; enforce bounds and timeout |
| Operate locks, alarm modes, cameras, access credentials, valves outside emergency policy, or other security-sensitive devices | `material` | No | Exact target/action confirmation, authenticated operator identity, result verification, and audit record |
| Modify deterministic fire, leak, freeze, alarm, equipment-shutdown, emergency-lighting, fall/panic, or e-stop logic | `material` | No | Independent deterministic design; explicit approval; syntax and scenario tests; offline test; rollback; never make LLM availability a runtime dependency |
| Execute an already-deployed deterministic emergency response | `deterministic-emergency` | Yes, by local deterministic policy | Must operate without Orchestrator, models, cloud, or internet; append evidence when logging is available |
| Start, stop, restart, install, remove, or reconfigure a noncritical service | `controlled-change` | Only under a named service-lifecycle delegation | Preflight dependents; bounded target; health checks; rollback/recovery |
| Change a critical, shared, security, data, or safety-supporting service | `material` | No | Exact confirmation, dependency and outage plan, backup, verification, and recovery gate |
| Modify application or infrastructure configuration | `controlled-change` | Only in an isolated target or under a narrow file/setting delegation | Exact diff, validation command, authoritative state check, rollback copy |
| Delete data, destroy resources, overwrite the only copy, or perform a nonrecoverable action | `material` | No | Exact targets, retention/backup proof, consequence statement, and immediate confirmation |
| Create users, change permissions, rotate credentials, or expose a service/network path | `material` | No | Exact identity/path, least privilege, secret-safe handling, access verification, and rollback |
| Send household operational alerts through an approved channel | `routine-reversible` | Yes, within notification policy | Deduplicate, rate-limit, record destination and delivery result |
| Send personal, legal, medical, financial, employment, or other consequential external communications | `material` | No | Show exact recipient and final content; obtain confirmation immediately before send |
| Make any purchase, payment, booking, trade, subscription, or other financial commitment | `material` | No | Show exact counterparty, item/service, total, fees, timing, and cancellation terms; confirm immediately before commitment |
| Run provider analysis or compare OpenAI, Anthropic, xAI, or local-model outputs | `routine-reversible` | Yes, within privacy and spend limits | Record provider/model, usage, latency, failures, and normalized response; consensus grants no authority |

## 3. Confirmation envelope

A controlled or material proposal must include, as applicable:

- exact target and requested end state;
- current authoritative state;
- proposed diff or typed action;
- affected people, devices, services, and dependencies;
- cost, fees, substitutions, recipients, or exposure changes;
- risks and expected interruption;
- validation and authoritative success criteria;
- rollback or recovery procedure;
- confirmation expiry and idempotency key for external side effects.

If any material field changes after confirmation, the confirmation is void and must be requested again.

## 4. Failure behavior

- Fail closed when authority, identity, scope, target state, or confirmation is ambiguous.
- A provider outage degrades analysis; it does not bypass policy.
- A failed external side effect is reconciled before retry. Never submit a second purchase or message merely because the first response was uncertain.
- Verification failure triggers the recorded rollback or recovery path when safe; otherwise stop and escalate.
- Deterministic emergency logic continues locally even when logging or the Orchestrator is unavailable.

## 5. Approval record

Operator approval of this matrix authorizes it as the design contract for the sandbox. It does not grant standing delegation for any real household write. Real delegations are separate, explicit records.
