# Security boundaries

The public static demo is disconnected from household services. Publish only the generated `dist` directory for demonstrations.

The included energy history was explicitly approved by its owner for this demonstration. Identifiers and unrelated metadata are excluded, but consumption patterns can still reveal household routines. Treat replacing or expanding this sample as a deliberate disclosure decision, not an automatic export of a live database. Other demo measurements and security results are labeled illustrations.

The backend is a local prototype. It does not provide production-grade account authentication, authorization, TLS, tenant isolation, or a hardened public server. Household profiles and the optional profile-switch PIN are convenience features, not security boundaries. A trusted person who can use the API can read household records. Do not store sensitive health, insurance, payment, or credential documents in the web root.

Defaults bind the backend to loopback. Remote writes require an explicit setting; household mutations also enforce same-origin browser requests. Network allowlists and Origin checks are defense in depth, not authentication. Do not forward the ports through a router, expose them through a public tunnel, or enable remote writes on an untrusted network.

The Powerwall adapter rejects non-loopback clients, starts with live polling and commands disabled, and requires separate opt-ins for commands and notifications. Financial estimates are withheld until rates are explicitly configured. Review all device mappings before enabling controls. The presence monitor requires an explicit opt-in even when a Home Assistant token exists.

Keep credentials in a suitable secret store or local environment, not in Git, URLs, screenshots, logs, source code, or the browser demo. Rotate a credential if it was actually exposed; merely deleting it from the latest commit does not remove prior copies. Use scoped credentials and revocation procedures appropriate to each provider.

This source includes integration and control capabilities. Tests cover selected input, boundary, and UI behavior, not a comprehensive security audit. A current check is not proof of safety, and missing telemetry is not an all-clear.

## Reporting

Use the repository's private vulnerability reporting channel if its owner has enabled one. Do not place private addresses, tokens, records, or exploit details in public issues. If no private channel exists, ask the maintainer for one without disclosing sensitive details.
