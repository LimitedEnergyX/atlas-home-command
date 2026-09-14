# Local service migration preview

Status: isolated preview, not the live application's database. No Supabase
schema, permission, connection, or household record has been changed by this service.

## Implemented

- SQLite persistence outside the static web/source directory.
- Explicit tenant ownership on every application record and tenant-inclusive
  relationships. Household tenant `0` has no special cross-tenant privilege.
- Repository, application service, and HTTP adapter boundaries.
- Server-supplied identity and role checks. The preview fixes this identity to
  tenant 0 on a trusted workstation; it does **not** implement production login.
- Atomic database mutations, revision conflicts, and transactional audit records.
- Atomic recipe-and-ingredient command, stable ingredient IDs, editor-snapshot
  conflict detection, and idempotent same-request retries. Command receipts
  commit in the existing audit table; no schema or permission changes required.
- Nullable meal slots and multiple meal records per day, preserving original IDs.
- Import verification against all original source fields and counts.
- SQLite backup with integrity and relationship checks, plus a separate migration
  verification that compares every backed-up table and the schema.
- Original interface loaded without editing `index.html`. The temporary
  `local-client.js` compatibility bridge replaces its Supabase SDK at preview time.

## Run tests

From this directory, using an available Python 3.11+ and Node runtime:

```text
python -B -m unittest test_local test_recipe_command
node --check local-client.js
node --check preview-ui.js
```

## Stage, never overwrite

Take a fresh backup using `tools/recipe-maintenance/backup_db.py` first. Its six
application tables are not a full Supabase disaster-recovery export.

```text
python -B migrate.py --snapshot <verified-backup-directory> --database <new-private-staging-path>
python -B preview.py --database <new-private-staging-path>
```

The preview listens only on `127.0.0.1:18089`. It is not a LAN deployment and must
not be bound publicly or reverse-proxied into production without authentication.
Only allowlisted assets are served. The database and backups must remain outside
the source/web directory. Do not put credentials, household exports, or database
files in Git.

`verify_migration.py` is a deliberately household-specific acceptance fixture.
It updates only the known Sunday brunch slot in an isolated imported copy,
checks every original field and ID, and verifies a new backup. It is not a
general migration and must not be run against production. It refuses to
overwrite an existing post-test backup.

## Constraints and compatibility differences

- This is a new local schema, not an assertion that Supabase's policies and
  constraints were copied. The original cloud schema and permissions remain untouched.
- Referenced recipe and stock deletes are restricted. There is no implicit
  cascade. This can intentionally reject a deletion the old interface expected
  to succeed; resolve the relationships explicitly, not by dropping constraints.
- There is no unique week/day or week/day/slot constraint. Breakfast, lunch,
  dinner, and multiple menu dishes may coexist. Preventing retry duplicates will
  require explicit idempotency keys, not a one-meal-per-day restriction.
- Dismissed grocery items retain uniqueness within tenant/week/item key.
- Existing historical meals retain a null slot; no blanket Dinner backfill.
- Foreign-key validation passed for the imported household data. This does not
  establish which constraints exist in the inaccessible live cloud schema.
- The live legacy recipe editor still uses multiple requests. In the isolated
  preview, `preview-ui.js` overrides that Save handler and uses the single
  `/api/v1/commands/save-recipe` endpoint. Failure rollback, stable ingredient IDs,
  unchanged-request retries, and stale edits are tested. A lost response can be
  retried unchanged while the form remains open. Retry identity is not persisted
  across closing/reopening the page, so re-read before re-entering a new recipe.
- Preview AI handoffs are deliberately non-operational: test-only prompt text,
  no production URL or skill activation command, and disabled assistant links.
- The bridge implements the current UI's query subset, not the Supabase API.
  Queries currently return complete rows and lists. It is transitional.

## Cutover gates

1. Verify visible UI save/reload, shopping handoffs, and all edit paths.
2. Add authenticated sessions, tenant membership resolution, CSRF protection,
   and an explicit least-privilege maintenance identity. Never trust a tenant ID
   or role supplied by the browser.
3. Extend idempotent business commands beyond recipe saves. Recipe atomicity is
   now implemented and tested in the preview, not deployed to live. Verify slow
   network/disconnection behavior across the remaining operations before cutover.
4. Configure host service startup, health checks, private file ACLs, backup
   retention, an off-host backup destination, and a timed restore drill.
5. Take a final verified snapshot under a short write freeze, import to a new
   database, compare every record, switch the application connection, and test
   through the household's actual devices.
6. Preserve the previous connection and rollback checkpoint. After local writes
   begin, a rollback needs reconciliation; it cannot discard those writes.
7. Retire cloud dependence only after acceptance. Do not delete cloud data as a
   shortcut or leave two writable sources of truth.

See `ARCHITECTURE.md` for the scale path and deliberately deferred work.

## Full AI operating charter

The chef's server-owned system message starts with the complete, verbatim
`AI_RULES.md` from this repository's root. This portable copy contains all ten
rules, How To Work, and the operating promise. It has no runtime dependency on
an Atlas directory or the browser. Its pinned SHA-256 is
`7d2b000b6ad0a338b5c696a746c8ed91b1986406be3f0dd9709860703dc4fcb5`.

`ai_charter.py` checks the file on every chat request and again at the inference
boundary. Missing, shortened, or modified policy pauses chat with a clear error;
it does not prevent service startup or manual stock, recipe, and meal controls.
The full text is injected once, not summarized. Policy updates require updating
the approved complete file, its pinned digest, and the regression expectations
together. Tests do not require access to the canonical Atlas checkout.

The per-request Ollama context is now explicitly **16,384 tokens**, with a
700-token output limit. The previous 4K context is not used for the larger
charter-bearing prompt. A conservative budget counts every UTF-8 content byte
as a possible token, includes the output schema and output allowance, and
reserves 512 template tokens plus 32 per message. This avoids a casual chars/4
estimate; it is an admission bound, not a claim about measured tokenizer usage.

When needed, only the oldest prior conversation turns are omitted. The returned
warnings disclose the omitted-message count and ask the user to restate needed
details. The charter, current message, and selected stock facts are never
shortened. If those fixed inputs alone exceed the bound, the request is rejected
with guidance to shorten it or identify the product more specifically. The
service never relies on runtime truncation to make a request fit.

The database command schema, allowed models (Gemma4 12B and Phi4 14B), explicit
review/apply boundary, candidate checks, revisions, receipts, and local transport
are unchanged. No execution tools are sent to Ollama. Full policy injection is
not a substitute for these deterministic safeguards and does not prove that a
model will follow every ethical instruction.

Run the full regression and focused policy tests without real model calls:

```text
python -B -m unittest discover -p "test_*.py"
python -B -m unittest test_ai_charter
```

The new context setting still needs a coordinated real-model GPU-memory,
latency, and prompt-token check before operational performance is claimed.
Reload the preview only after coordinating its pending requests/proposals; this
documentation or test run does not restart it or update household records.
