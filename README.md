# Atlas Home Command Center

A local-first household dashboard for energy, home controls, appointments, vehicles, travel, pantry, and maintenance.

This repository is a **sanitized distribution**, not a backup of a household installation. It starts without personal records or credentials. Optional integrations require your own configuration and authorization. Local-first does not mean every provider works offline: Tesla and some Home Assistant integrations depend on their vendor clouds.

## September interface update

- **Energy:** one page with an illustrative house and compact history on the left, aligned readings and billing estimates on the right. Smaller screens stack the content. History opens on House Load; a refresh preserves the selected view and period.
- **Vehicle charging:** a separate tab after Grid, periodic charge readings, and reviewed charging references. Missing source attribution stays unknown. House Load includes charging when the provider does not supply a separate vehicle channel.
- **Calendar:** a read-only, reviewed appointment snapshot with dates, cancellation state, and freshness. This is separate from the energy-history calendar and is not automatic Google Calendar synchronization.
- **Vehicles / Argo:** local vehicle profiles and concise service records. The public database starts empty. A local insert-only importer supports the three existing vehicle slots.
- **Travel:** trip records, provider evidence, coverage status, and recorded per diem. Card use or a saved note does not verify insurance or lounge eligibility.
- **Home:** one-tap module navigation, compact status, configured light controls, and shared HVAC controls.

The demo uses generated artwork and fictional household, vehicle, calendar, and travel examples. Sol includes the owner's explicitly approved house illustration; the Home hero is separate and unchanged. Vehicle artwork includes a Tesla Model Y, and the Dallas storm radar is clearly labeled as simulated. The previously approved energy samples retain their original dates; they are not live readings.

![Owner-approved energy house artwork](orchestrator/src/atlas_orchestrator/web/atlas-house-hilltop.png)

## Preview without connecting anything

Requires Python 3.12 or newer and Node.js 24 for the checks.

```sh
python tools/build_demo.py
node tools/test_demo.cjs
python -m http.server 8088 --bind 127.0.0.1 --directory dist
```

Open [the local demo](http://127.0.0.1:8088/). Only the generated static files are served. Browser data requests are answered by fixtures, external fetches and mutations are rejected, and the demo contains no backend or household credentials. Stop the preview server when finished.

See [demo data](docs/demo-data.md) for the distinction between recorded energy and illustrative records.

## Run the local application

```sh
python -m venv .venv
# Activate the virtual environment for your operating system.
python -m pip install ./orchestrator
atlas-orchestrator --data-dir ./data serve --host 127.0.0.1 --port 8080
```

Start on loopback. Review [configuration](docs/configuration.md), [security boundaries](SECURITY.md), and the [authority matrix](docs/AUTHORITY_MATRIX.md) before connecting services or exposing the application to another device. This release does not configure router forwarding, public tunnels, cloud receivers, credentials, or scheduled tasks.

The optional Node energy service is separately configured and disabled by default. The Python shell reads its normalized output through a loopback endpoint. See [basic Tesla vehicle reads](docs/tesla-basic.md) and [reviewed record formats](docs/reviewed-records.md).

## What is connected, and what is not

| Area | Public distribution |
|---|---|
| Home Assistant | Server-side connector and bounded control routes; requires operator configuration |
| Powerwall | Optional Tesla Fleet API energy adapter; live access, commands, and notifications default off |
| Tesla vehicle | Optional outbound charge-state reader, at most every 30 minutes, with a persisted request budget and no wake or vehicle commands |
| Calendar | Saved snapshot only; no email or calendar-account connection bundled |
| Vehicles | Empty SQLite store and local insert-only import; no document server or automatic service-history lookup |
| Travel and maintenance | Local records and review workflows; no booking, payment, or provider verification performed automatically |
| GalleyQuest | Pantry integration contract and standalone app; public orchestrator does not serve a separate private checkout |
| AI | Optional configured providers; no model or paid fallback is activated by this release |

The basic vehicle reader is **not a complete charging-session collector**. Sleeping vehicles and short sessions can be missed. Repeated readings contain cumulative session counters and must not be added together. A Mobile Connector does not give this reader a separate home-energy meter. A local zero-dollar configuration is an operator assertion, not a guarantee about Tesla billing.

## Safety and verification

The versioned [operating charter](AI_RULES.md) is checked before AI requests. Models cannot grant themselves permission. Server-side policy validates supported actions independently, and reads after commands distinguish a request being accepted from its outcome being observed. This is not a certified life-safety system.

Use the checks in [.github/workflows/verify.yml](.github/workflows/verify.yml) and the [release notes](docs/releases/2026-09-energy-vehicles-calendar.md). Tests use temporary records and mocked services. Passing tests does not establish compatibility with every device, restore complete backups, verify a provider account, or guarantee absence of sensitive data. Review the exact publication diff and generated files before pushing.

## License and contributions

See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). The energy adapter retains its separate ISC notice. Do not include personal records, credentials, raw account responses, household photos, or runtime databases in contributions.
