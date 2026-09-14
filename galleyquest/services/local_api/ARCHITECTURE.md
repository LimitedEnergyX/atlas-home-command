# Architecture decision: household first, tenant-ready boundaries

2026-09-13. This is a migration foundation, not a claim of SaaS readiness.

## Direction

Build one modular application with a service-owned database. Do not add
microservices or multiple databases simply because a cafeteria is possible.
Keep business operations behind an API, and keep persistence out of the UI.

The household is tenant `0`, an ordinary customer workspace. A future cafeteria
is another tenant, with its own members, locations, inventory, recipes, plans,
orders, and audit trail. System administration must be a separate, explicit
capability, never an implicit property of tenant 0 or an owner role.

| Boundary | Present foundation | Expansion required |
|---|---|---|
| Ownership | Composite tenant/record IDs and tenant-scoped foreign keys | Authenticated user membership and tenant switching |
| Authorization | Repository roles and server-created principal | Login, session lifecycle, invitation, revocation, and role administration |
| Operations | Transactions, audit, and revisions | Atomic business commands and request idempotency |
| Storage | Local SQLite repository | PostgreSQL repository, migration tooling, and equivalent integration tests |
| Inventory | Original status and notes preserved | Quantities, units, locations, lots, and movement ledger |
| Planning | Multiple meals per day and nullable slots | Recipe versions, yields, portions, demand, and leftovers |
| Recovery | Verified import and local backup readback | Scheduled retention, off-host copy, and operational restore drills |

## Domain model to grow into

Do not encode structured data only in notes or names. Preserve existing notes
as source evidence during incremental migrations. Do not infer precise usable
quantities, yields, or allergen safety from ambiguous text.

- **Workspace and membership:** tenant, user, membership, role. Resolve tenant
  and permissions from the authenticated session on every request.
- **Locations:** tenant-owned storerooms, refrigerators, and kitchens. A locations
  table is seeded today; stock allocation by location is not yet implemented.
- **Catalog:** an ingredient/item concept separate from a purchased product,
  brand, pack size, and supplier SKU. Shared public catalog data, if introduced,
  must be distinct from private tenant records.
- **Inventory:** lots with acquisition, expiry, and storage location; an immutable
  movement ledger for received, consumed, wasted, transferred, and adjusted stock.
  Corrections create reversing entries. On-hand balances are derived or cached
  with transactional reconciliation.
- **Units:** exact decimal quantities and defined dimensions. Count, mass, and
  volume are not interchangeable without an explicit conversion. Use integers
  in minor units for money and a currency code, not binary floating-point totals.
- **Recipes:** versions, ingredient quantities, yield, and portion unit. Existing
  meal plans should keep the intended recipe version when a recipe changes.
- **Menus and plans:** tenant-local dates, service periods, dishes, planned
  portions, and reservations of demand. Planning is not consumption. Cooking or
  another explicit fulfillment action records actual usage and leftovers.
- **Purchasing:** supplier, order, line, receipt, substitution, return, and refund.
  Store/order/line identifiers and idempotency keys prevent double reconciliation.
  Only received quantities enter usable inventory.
- **Cafeteria extensions:** production batches, prep tasks, waste reporting, and
  configurable dietary/allergen metadata. Food-safety and regulatory workflows
  require separate requirements review before being presented as dependable.

## Growth and security

SQLite on a single host is the first deployment target, not a distributed
database. Its transactions are useful now, but its write concurrency and host
availability limits remain. Do not share its file over a network filesystem or
run independent writable copies on several servers.

Evaluate PostgreSQL when concurrent writers, multiple application instances,
availability targets, or hosted tenants justify it. SQL types, migrations,
transactions, and backup procedures will need deliberate work. This is not a
one-line engine swap. The API and domain boundaries are intended to spare the
interface and business workflows from a complete rewrite.

Before hosting unrelated customers, require independent cross-tenant security
testing, authenticated membership enforcement, rate limits, pagination, secure
session handling, a secrets lifecycle, export/deletion rules, tenant-aware jobs
and caches, and documented recovery objectives. PostgreSQL row-level security
can provide defense in depth but does not replace application authorization.

The current preview has a fixed local identity, inline-script compatibility, and
unbounded list reads. Do not describe it as hardened, load-tested, or publicly
multi-tenant ready.

## Migration discipline

Use versioned, incremental migrations with a verified recovery point. Never
rewrite IDs or flatten historical records merely to satisfy a new schema.
Introduce new fields alongside old ones, validate and reconcile conversions,
then update readers and writers. Remove old fields only after acceptance.

Business commands should become the stable interface: save meal, replace recipe,
receive order, record consumption, and adjust stock. The Supabase-shaped bridge
is a temporary compatibility layer, not the long-term public API.

Finish dependable household operation before commercial features. The order is:
safe cutover, quantities and portions, idempotent receipts, inventory movements,
multi-location workflows, and then a separately reviewed hosted-tenant deployment.
