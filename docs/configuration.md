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
