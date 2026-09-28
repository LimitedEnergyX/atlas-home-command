# Basic Tesla vehicle reads

This optional collector uses outbound requests from the existing loopback energy service. It does not require a public receiver, a tunnel, or router forwarding. It is not Fleet Telemetry, a vehicle controller, or a complete charging-history service.

## Before enabling

- Keep the static demo disconnected. It never needs Tesla credentials.
- Configure the energy adapter and protected token helper first, as described in [configuration](configuration.md).
- Verify the current Tesla account billing policy, balance, and limit directly in the developer portal. The local reader checks an operator-supplied zero-dollar assertion, not the portal. Neither this setting nor the request cap guarantees free service or access when the provider rejects requests.
- Authorize read-only vehicle information for your own vehicle. With the vehicle opt-in, the adapter requests `vehicle_device_data`; it does not request vehicle commands, location, or charging-management scopes. An existing energy-only token may need consent again.
- This adapter targets the North American Fleet API. Other regions require an intentional code/configuration review.

## Local configuration

Both `ATLAS_POWERWALL_LIVE=1` and `ATLAS_TESLA_VEHICLE_READ_ENABLED=1` are required. Keep `ATLAS_POWERWALL_ALLOW_COMMANDS` unset. The ordinary browser refresh is not a vehicle-poll trigger.

In the directory selected by `ATLAS_POWERWALL_DATA_DIR`, create `athena-basic-config.json` with:

```json
{
  "enabled": false,
  "vin": "REPLACE_LOCALLY",
  "billing_limit_usd": 0,
  "billing_verified_at": "REPLACE_WITH_VERIFIED_TIMESTAMP"
}
```

The example is intentionally invalid and disabled. Supply your own VIN and timezone-bearing timestamp locally, and set enabled to true only after verification. Never commit this file. The `athena` filename is a legacy internal slot, not a requirement to name the vehicle Athena.

On first setup only, create `athena-basic-state.json` with `{"version":1,"months":{},"next_at":0}`. Do not replace an existing ledger: that would erase the request budget and saved readings. A missing or invalid ledger stops collection. Keep the data directory private and recoverable.

## Polling and failure behavior

- At least 30 minutes between reserved collection attempts, across restarts.
- At most 1,500 attempts per UTC month. Each attempt may include a vehicle-list request, a charge-state request if online, and token refresh work. The attempt cap is not a billable-request cap.
- A list check happens first. An asleep or offline car is not woken.
- Only approved charging fields are retained. Location and raw API responses are not saved.
- The most recent 1,500 observations are retained. Counters are cumulative within a reported session, not increments to sum.
- HTTP 401, 402, 403, 412, or 429 pauses further attempts pending operator review. A leftover lock also needs review; first confirm that no collector is running before removing a lock.
- Cached readings remain distinguishable from a current update. Turning off the environment opt-in prevents polling even if the local JSON still says enabled.

No charge limit, Charge on Solar setting, or vehicle command is changed. This release has not been tested against a live Tesla account. Revalidate provider requirements before activation.

For manually reviewed home-source or Supercharger references, see [record formats](reviewed-records.md). Periodic charge-state data alone does not establish Home/Supercharger location, a solar/Powerwall/grid split, or complete sessions.
