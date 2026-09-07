# Atlas

**A local-first household command center for energy, comfort, upkeep, and daily operations.**

Atlas brings solar and battery history, indoor conditions, service schedules, travel planning, pantry summaries, system observations, and AI-assisted review into one responsive workspace.

![Atlas concept artwork with a fictional home](orchestrator/src/atlas_orchestrator/web/heroes/atlas-home-desktop.png)

## Try the read-only demo

Requires Python 3.12 or newer. No accounts, secrets, npm install, or household services are needed.

```sh
python tools/build_demo.py
python -m http.server 8088 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8088`. The energy charts use owner-approved, recorded Tesla readings with identifying metadata removed. The frozen sample includes 2025 and 2026 yearly views, monthly views from August 2025 through September 2026, and detailed September 1–6, 2026 daily views. Dates outside the detailed sample select the nearest available recorded date, which is displayed explicitly. Missing energy intervals remain gaps, not invented readings.

The seven household staple names and four recipe titles and ingredient lists are owner-approved pantry references. Their meal schedule, stock, and pending purchases are illustrative, not a live grocery list. All other people, devices, weather, security results, service records, trips, rewards balances, and provider states are illustrative examples. Financial examples combine recorded energy with fictional rates and charges, not an actual bill. API requests are answered in the browser, writes are rejected, and the demo's content policy blocks network connections. Navigation, sample selection, charts, and responsive layouts remain interactive. It is not connected to a real home. No real scans or household commands run.

The demo includes a planned five-device UniFi network, 18 secondary intrusion-awareness sensors, 122 grouped sensor/entity examples, four meals for the next calendar week, two fictional United/IHG/Hertz trips, and annual solar cleaning. See [demo data and UniFi basis of design](docs/demo-data.md) for source boundaries and assumptions.

## Modules

| Area | Purpose |
|---|---|
| Home | Household overview, module navigation, and shared climate controls |
| Energy | Tesla-inspired Home, Solar, Powerwall, and Grid views with directional energy flows |
| Environment | Indoor temperatures, humidity, air quality, and configured weather sources |
| Security | Evidence freshness, cyber observations, and explicitly configured presence monitoring |
| Pantry | Optional pantry summaries and meal planning integration |
| Travel | Local itineraries, verification evidence, and cost tracking |
| Maintenance | User-entered service dates, upcoming tasks, and completion history |
| Systems | Configured services, device inventory, and integration status |
| Agents | Local model chat and budget-gated multi-provider review |

Each module has its own mythological identity: Vesta for Home, Sol for Energy, Aeolus for Environment, Titan for Security, Demeter for Pantry, Oracle for Travel, Vulcan for Maintenance, Athena for Systems, and Olympus for Agents. These are interface identities, not claims of independent autonomous agents.

## Run the local backend

The Python backend is an experimental, single-household service, **not an internet-facing application**. Review [SECURITY.md](SECURITY.md) before connecting real equipment.

```sh
python -m venv .venv
# Activate .venv using your shell's normal activation command.
python -m pip install -e ./orchestrator
atlas-orchestrator --data-dir ./data serve
```

Default address: `http://127.0.0.1:8080`. Missing integrations display unavailable, not invented readings. SQLite records stay in the selected data directory. Back up that directory separately; operational databases and private configuration are not included. The only published household measurements are the approved, frozen energy samples described above. The approved pantry references include names and ingredients only, with no private database IDs or purchase history.

Configuration is environment-based. See [configuration](docs/configuration.md). Energy calendar handling currently uses `America/Chicago`; other installations must adapt and validate that timezone, including daylight-saving boundaries.

## Architecture

- Vanilla JavaScript and CSS frontend, served by the Python backend or exported as a static demo.
- Python orchestration, input validation, local evidence stores, and adapter boundaries.
- Optional Node.js Tesla energy adapter, disabled until explicitly configured.
- SQLite storage for maintenance, energy history, household messages, and request records.
- No cloud service is required for the static demo. Real integrations and optional model providers have their own access, costs, and terms.

## Verify

```sh
python -m pip install pytest
python -m pytest orchestrator/tests -q
python tools/check_release.py
python tools/build_demo.py
node tools/test_demo.cjs
```

Run the Node UI tests in `orchestrator/tests/test_*.cjs` as well. The GitHub workflow runs these checks automatically. Tests use temporary records and mocked integrations; they do not certify a real installation's security or recovery.

## Publish the demo

The workflow builds a `dist` artifact without deploying it. Upload its contents to a static host, or configure GitHub Pages to deploy that artifact after reviewing repository visibility and settings. Never deploy the Python or Powerwall backend as a public demo. A project-subpath deployment is supported by relative asset URLs.

## License and assets

Source is available under [MIT](LICENSE), with the existing energy adapter's ISC terms retained in [third-party notices](THIRD_PARTY_NOTICES.md). See [asset provenance](ASSETS.md). Product names identify optional integrations; this project is not affiliated with or endorsed by Tesla, OpenAI, or other named providers.
