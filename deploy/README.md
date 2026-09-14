# Atlas consolidated container stack

This is the single Compose project for Atlas Home OS dependencies. It is staged
but not activated until Docker Desktop is installed and the restored volumes are
verified.

Profiles:

- `energy`: InfluxDB and Grafana
- `home`: Home Assistant
- `notifications`: ntfy
- `ai`: SearXNG and Open WebUI
- `energy-container`: the future containerized Powerwall adapter

All host mappings use the approved Atlas port plan and bind to loopback. ntfy or
Home Assistant can be deliberately exposed to LAN/Tailscale later if their phone
clients require direct access. Atlas Home OS remains the normal port-80 front door.

Before the first start:

1. Install Docker Desktop without changing the storage or RAID configuration.
2. Run `scripts\restore-atlas-docker-volumes.ps1` and review its manifest.
3. Validate one profile at a time with `docker compose config`.
4. Start only that profile and inspect its health before continuing.

The host-native Energy adapter currently owns port 17082. Stop that verified
process before activating the `energy-container` profile.
