# Local configuration

Set variables in your shell or service manager. The Python backend does not load a dotenv file automatically. Do not commit real values.

| Variable | Default / behavior |
|---|---|
| `ATLAS_HOST`, `ATLAS_PORT` | `127.0.0.1`, `8080` |
| `ATLAS_DATA_DIR` | Local `data` directory |
| `ATLAS_TRUSTED_NETWORKS` | Loopback only |
| `ATLAS_ALLOW_REMOTE_WRITES` | `0`; do not change without an authenticated access boundary |
| `ATLAS_STATUS_CONFIG` | Optional local service-check JSON |
| `ATLAS_HOME_ASSISTANT_URL` | Loopback adapter address; configure your own |
| `ATLAS_HOME_ASSISTANT_TOKEN` | Unset; required for real Home Assistant access |
| `ATLAS_IDS_MONITOR_ENABLED` | Unset; `1` explicitly starts presence monitoring |
| `ATLAS_HOME_BACKUP_ROOT` | `home-assistant` inside the data directory |
| `ATLAS_POWERWALL_STATUS_URL` | Loopback energy adapter URL |
| `ATLAS_GALLEYQUEST_CONFIG` | Optional configuration for pantry summaries, not a served directory |
| `ATLAS_OLLAMA_MODEL`, `ATLAS_OLLAMA_BASE_URL` | Local model name and loopback Ollama URL; used when no Hermes URL is set |
| `ATLAS_HERMES_API_URL`, `ATLAS_HERMES_API_KEY`, `ATLAS_HERMES_SESSION_ID` | Optional loopback Hermes agent API; when set, chat planning goes through Hermes instead of Ollama directly |
| `ATLAS_GARAGE_ENTITY_ID` | Unset; a `cover.*` entity with `device_class: garage` must be named explicitly before garage closure is possible |
| `ATLAS_HOME_ASSISTANT_TOKEN` and the six light/plug entity ids in `household_tools.py` | Replace the example entity ids with your own before enabling controls |

Device entity identifiers in the source are generic examples. Map and validate them against your own installation before enabling controls. Native cyber collection is an optional Windows integration; configure its input directory explicitly and review its source before use. The repository does not install a privileged collector or scheduled task.

## Optional energy adapter

```sh
cd services/powerwall
npm ci --ignore-scripts
npm test
npm start
```

Without opt-ins, only `/api/health` returns status. Live integration requires `ATLAS_POWERWALL_LIVE=1`, Tesla client/site credentials, an authorized refresh token, and any provider-required registration. Supply secrets through your service environment. The OAuth callback requires an operator-configured protected secret helper; none is bundled.

Commands additionally require `ATLAS_POWERWALL_ALLOW_COMMANDS=1`. Notifications require that setting and `ATLAS_NOTIFICATIONS_ENABLED=1`. Keep all adapter access on loopback. The Dockerfile packages the source, but container routing and secret storage require installation-specific validation.

Weather requires explicit `LAT`, `LON`, and an optional display label `WEATHER_LOCATION_LABEL`. NWS alerts require `NWS_ZONES` and a valid `NWS_USER_AGENT`. No location is inferred. Configure `ATLAS_INFLUX_ENABLED=1` only with the appropriate Influx credentials and storage.

Utility variables use the `UTILITY_` prefix: `ENERGY_RATE`, `BUYBACK_RATE`, `BASE_CHARGE`, `TDU_FIXED`, `TDU_KWH`, `GRR_RATE`, `TAX_RATE`, `BUYBACK_BANK`, and `CYCLE_DAY`. Financial output also requires `ATLAS_RATES_CONFIGURED=1`. The calculation is a configurable estimate based on a particular tariff structure, not a universal billing engine or billing advice. Verify it against the actual contract and statement before relying on it.

## Reviewed records and vehicle readings

For the optional outbound-only vehicle reader, see [Basic Tesla vehicle readings](tesla-basic.md). It is disabled by default and does not require an inbound receiver or router forwarding.

For the saved calendar, charging references, and insert-only vehicle importer, see [Reviewed local records](reviewed-records.md). These files are private operator inputs, not public demo fixtures.

## AI operating charter

`AI_RULES.md` at the repository root and the packaged copy in `orchestrator/src/atlas_orchestrator/AI_RULES.md` must stay byte-identical, and their SHA-256 must match `AI_RULES_SHA256` in `ai_rules.py`. Every AI request verifies this. To adopt your own charter, edit both files, update the hash, and run the tests. A mismatch stops AI requests and leaves manual controls working.

## GalleyQuest

The `galleyquest/` directory is the integrated pantry app. The private deployment serves it from Atlas at `/galleyquest/` with the data-store configuration injected from the host credential store; this public distribution does not serve it (see `SECURITY.md`). Run it standalone with `node galleyquest/server.js` after copying `galleyquest/config.example.js` to `galleyquest/config.js`. The local SQLite service in `galleyquest/services/local_api` is a loopback preview, not the live data path.
