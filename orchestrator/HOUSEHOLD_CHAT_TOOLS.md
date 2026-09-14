# Local household chat tools

Atlas chat uses one local Hermes planning call, followed by an independently validated
Home Assistant execution path. The model cannot grant itself additional authority.
The complete AI operating charter remains in the planning prompt.

## Supported requests

- `close the garage`
- `set temp to 80 degrees`
- `turn the driveway light on`
- `turn off all lights`
- `turn on the living room TV`
- `turn off both TVs`
- `set HVAC mode to cool`
- `set HVAC fan to auto`
- `are all leak sensors dry?`
- `is the dryer running?`
- `is the refrigerator door open?`
- `what is the thermostat temperature?`
- `are the TVs on?`
- `close the garage and set temp to 80`

The first release deliberately accepts a bounded command vocabulary. It refuses
unsupported targets, unclear commands, conditions, quoted commands, and contradictory
instructions rather than guessing. Thermostat targets are whole numbers from 60 to
85°F. Only the existing six approved Atlas lights/plugs and the registered bedroom
and living room TVs are available. TV power is enabled only when Home Assistant reports
the device available and advertises the requested power capability. TV volume,
inputs, appliance starts, cameras, and alarm/security settings are not enabled.
HVAC modes and fan settings must also be advertised by the live thermostat.

Basic Atlas status questions use a fresh, read-only Home Assistant query through
Atlas's chat endpoint, without model inference. GalleyQuest retains its existing
inventory-specific adapter to the same local Hermes runtime. Answers describe
reported states, not an independent physical inspection. Unavailable readings remain
unknown. Leak checks cover the six explicitly configured sensors, not every possible
sensor. Dryer/washer machine and job states, refrigerator/freezer door contacts, garage,
approved lights, TVs, and thermostat readings are supported. Historical or procedural
questions do not take this current-state shortcut.

## Execution and evidence

Hermes returns typed `tool_commands`. Atlas matches the complete proposal against the
current request, not history or memory. It reads fresh device state, skips requests
already satisfied, sends no automatic POST retries, and polls for the requested state.
A closing garage is observed without sending another closure request. The executor's
observed results replace the model's proposed answer. Combined requests retain separate
results, including unavailable devices and unverified outcomes.

The authenticated, trusted-network `/v1/chat` route retains its existing access checks.
`dry_run: true` validates proposals and reads current state without invoking writers.
Preview responses are identified as previews, not successful changes.

## Hermes boundary

Hermes's `api_server` platform is limited to `web`, `memory`, and `session_search`, with
the `no_mcp` sentinel. It cannot execute shell/file/code/browser/delegation/cron or MCP
tools independently of Atlas. Other platform selections are unchanged. Internet
research remains available. No paid-cloud fallback was added.

The managed Atlas launcher reloads the saved local Hermes URL/key and retains the
`atlas-household` session, Home Assistant credentials, and existing network settings.

## Garage prerequisite

Garage closure is unavailable until the actual door controller is connected to Home
Assistant. `ATLAS_GARAGE_ENTITY_ID` must explicitly identify its `cover.*` entity and
that entity must report `device_class: garage`. Atlas never substitutes a leak/contact
sensor or guesses a control from its display name. Configure and verify the controller
and its existing safety behavior before enabling physical closure.

## Verification limits

The command tests use simulated devices. A live preview verifies Hermes planning and
real Home Assistant reads without physical changes. Neither test establishes actual
garage movement or full household disaster recovery. Future tools, including
GalleyQuest writes or maintenance repair execution, require their own bounded adapters
and verification before being enabled.
