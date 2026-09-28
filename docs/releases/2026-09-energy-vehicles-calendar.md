# Energy, vehicles, and calendar release candidate

Prepared September 24, 2026, with owner-approved artwork revisions September 25. The live household deployment was not changed while preparing this update.

## Included

- One energy page with house artwork and history on the left, aligned data and financial tiles on the right, and a stacked mobile layout.
- House Load wording, Vehicle after Grid, and selected-history preservation on refresh.
- Vehicle readings separated from reviewed charging references. Home-source breakdowns and rated miles appear only when supplied. Unknown values are not zero readings, and cumulative session counters must not be added together.
- Optional outbound-only Tesla vehicle reads through the existing energy adapter. Collection is disabled by default, does not wake the car, and sends no vehicle commands. No inbound receiver, Tailscale Funnel, or port forwarding is required.
- Read-only saved calendar snapshots and generic vehicle pages, plus a validate-first, insert-only vehicle-record importer.
- Travel display corrections for configured cards, lounge evidence, and recorded per diem. No benefit eligibility is inferred.
- Owner-approved Sol house artwork, photographic-style generated Model Y, Silverado, and Harley artwork, explicitly simulated Dallas radar, fictional calendar and vehicle examples, refreshed setup documentation, and a disconnected static demo. The Home hero is unchanged.

## Privacy and authority

The owner explicitly approved reuse of the existing generated hilltop-house illustration. It depicts the owner's property and is not anonymous. No owner vehicle photographs, plates, VINs, medical documents, travel itineraries, credentials, or private databases from the development deployment are included. Previously approved historical energy samples remain date-labeled and separate from fictional examples.

The demo rejects network fetches outside its bundled data and rejects mutations. The optional runtime integrations require explicit operator configuration. Calendar snapshots are not automatic Google Calendar synchronization. Vehicle controls remain disabled. No paid service was configured or activated for this release.

## Verification

Local checks passed:

- Python orchestrator: 214 tests and 118 subtests.
- GalleyQuest: 58 unit tests.
- All eight JavaScript UI suites, including chart rendering at five input widths.
- Static demo: 22 recorded energy periods, disconnected data, mutation rejection, relative assets, and content security policy.
- Household rendering: sensor types, meal and purchase examples, travel details, and rewards examples.
- Tesla reader: concurrent access, restart behavior, persistent request limits, asleep/no-wake behavior, stale retention, access and billing pauses, corrupt or missing ledgers, and minimal returned fields.
- Energy adapter: live reads and commands disabled by default, with cross-origin access rejected.
- Python package wheel build and whitespace checks.

The visible browser review covered desktop and phone layouts, calendar and vehicle rendering, loaded artwork, and energy-date labeling. A mobile demo-banner overlap was corrected, and the vehicle page's Home link was verified afterward. These checks do not establish identical behavior on every browser, device, zoom level, or live provider account.

## Deliberate limits

- Basic vehicle polling has a minimum 30-minute interval and a persisted monthly attempt allowance. A request allowance is not a dollar billing cap or a promise of free API usage. Verify provider billing separately before enabling it.
- Basic readings do not establish a live House/Vehicle split, a complete charging-session history, or solar attribution.
- Reviewed files need operator maintenance. Missing records mean unknown, not overdue, canceled, completed, or zero.
- No live Tesla account, calendar account, home device, or travel account was exercised by this candidate's tests.

## Publication gate

The owner approved pushing this update on September 25. After publication, confirm the GitHub verification workflow before merging or tagging a release. This approval does not change the live household deployment.
