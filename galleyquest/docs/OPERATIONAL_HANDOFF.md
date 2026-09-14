# GalleyQuest — Operational Handoff

**GalleyQuest is now the only active/operational project.** The former
`D:\DEV\PANTRY` offline harness was consolidated into GalleyQuest and retired on
**2026-07-20** (see *Migration history*). PANTRY's full history is preserved in
an external archive, not in this repo.

This is an operational handoff, not product documentation. Facts are drawn from
the actual repo files, scripts, and verified live-database calls. Anything not
provable from those is marked **UNKNOWN**. No secret values (keys, tokens,
passwords, JWTs, connection strings) appear here — names and locations only.

## 1. Project overview

- **What GalleyQuest is:** a small self-hosted pantry-stock / recipe / weekly
  meal-plan app with a derived grocery list. Single-file static frontend
  (`index.html`, inline CSS + JS) plus `ui-cards.js`, backed by hosted Supabase
  (Postgres), served by a dependency-free Node static server (`server.js`, port 8000).
- **Local path:** `D:\DEV\GalleyQuest`
- **Repository / branch / HEAD:** git; branch **`responsive-card-grid`**, HEAD
  **`00a58b1`** at time of writing. Verify: `git -C D:\DEV\GalleyQuest log --oneline -1`.
- **Remotes:**
  - `origin` → the maintainer's public fork
  - `upstream` → the original author's repository
- **Relationship to the original repo:** this clone is a fork of
  the original author's repository. Local commits are **not pushed** — no PR, no
  remote branch, nothing deployed from here.
- **The live app:** a separate running instance at `http://aet-w11l.local:8000/`
  (local-network host), backed by the same Supabase project. The offline harness
  was originally extracted from it. (Evidence: `tools/offline-harness/extract.py`.)

## 2. Database

- **Platform:** hosted **Supabase** (PostgreSQL + PostgREST). Hosted, not local;
  not copied/migrated for the app (the app talks to the live project directly).
- **Project ref:** `<supabase-project>` (host `<supabase-project>.supabase.co`).
- **How the app connects:** frontend loads the Supabase JS client from a CDN;
  `config.js` (git-ignored) sets `window.SUPABASE_URL` + `window.SUPABASE_ANON_KEY`;
  the inline script calls `supabase.createClient(url, anonKey)` and uses
  `sb.from(...)`. Requests hit PostgREST at `/rest/v1/…`.
- **Connection config file:** `config.js` at the repo root (git-ignored; template
  `config.example.js`). Holds the Supabase URL + anon key. **Values not recorded here.**
- **Auth role:** the app authenticates as the **`anon`** role (JWT `role=anon`,
  confirmed by decoding claims).
- **CRUD that works (anon + PostgREST):** SELECT / INSERT / UPDATE / DELETE on
  table rows, subject to RLS. This is how all recipe data was read and written.
- **RLS / permissions:** RLS permits anon row CRUD on the app's tables (the app
  performs inserts/updates/deletes itself). Exact policy definitions are
  **UNKNOWN** (not readable via anon; PostgREST OpenAPI root returns 401 for anon).
- **CRUD ≠ DDL — important:** normal PostgREST CRUD with the anon key **cannot**
  change schema. Altering a constraint/table/type (DDL) needs elevated access
  (direct Postgres as owner/`service_role`, or the Supabase Management API with a
  personal access token). **None is available locally** — verified: no `psql`,
  no Supabase CLI, no service-role key, no DB password, no connection string, no
  admin credential in Windows Credential Manager; 5 common admin SQL RPC names
  probed → all 404.
- **Tables:** `stock_items`, `recipes`, `recipe_ingredients`, `meal_plan`,
  `grocery_extra_items`, `grocery_dismissed_items`.
- **Key columns / relationships** (from `tools/offline-harness/schema.sql`, inferred):
  - `recipes(id uuid pk, name text, theme text, instructions text, notes text, …)`
  - `recipe_ingredients(id, recipe_id → recipes.id ON DELETE CASCADE, stock_item_id → stock_items.id ON DELETE SET NULL, ingredient_name text, quantity text)`
  - `meal_plan(…, theme text, recipe_id → recipes.id, …)`
- **`recipes.theme` constraint:** CHECK constraint **`recipes_theme_check`**
  (confirmed by a live 400, code `23514`). Restricts `theme` to a fixed set or
  NULL; empty string is rejected.
- **Accepted theme values (empirically verified against the live DB, 2026-07-20,
  by PATCHing one temporary recipe through every value):** `Mexican, Thai, Asian,
  Crock Pot, Grab Night, Invention, Open` — or NULL.
- **Rejected:** `Tex-Mex, Southwest, Mediterranean` → HTTP 400, pg error `23514`,
  constraint **`recipes_theme_check`** (empty string also rejected).
- The app `THEMES` list (`index.html`) is set to exactly the 7 accepted values —
  **no code/DB mismatch.** Adding the three cuisine themes would need DDL on
  `recipes_theme_check` (elevated access not available locally).
- **`meal_plan.theme`:** **unconstrained** (verified: a test insert with an
  arbitrary theme succeeded, then was deleted).
- **Authoritative schema / migrations:** **none.** No migrations directory, no
  authoritative `pg_dump`. `schema.sql` is inferred — a reference, not truth. The
  authoritative schema lives only in the live Supabase project.

## 3. How data has been read and written

All recipe operations used **direct HTTPS calls to Supabase PostgREST** with the
anon key read at runtime from `config.js` — the same path the app uses, from
PowerShell. Credential handling pattern (no secrets shown):

```powershell
$cfg   = Get-Content 'D:\DEV\GalleyQuest\config.js' -Raw
$sbUrl = ([regex]::Match($cfg,"SUPABASE_URL\s*=\s*'([^']+)'").Groups[1].Value).TrimEnd('/')
$sbKey =  [regex]::Match($cfg,"SUPABASE_ANON_KEY\s*=\s*'([^']+)'").Groups[1].Value
$H = @{ apikey=$sbKey; Authorization="Bearer $sbKey"; 'Content-Type'='application/json' }
```

- **Read:** `GET /rest/v1/recipes?select=*,recipe_ingredients(*)`
- **Insert recipe:** `POST /rest/v1/recipes` body `{name, theme, instructions, notes}`
  with `Prefer: return=representation` to get the new `id`.
- **Insert ingredients:** `POST /rest/v1/recipe_ingredients` with a JSON **array**
  of `{recipe_id, stock_item_id, ingredient_name, quantity}`. Every object must
  have identical keys and the body must be a real array, or PostgREST returns
  `PGRST102 "All object keys must match"`.
- **Update:** `PATCH /recipes?id=eq.<id>`. **Delete:** `DELETE /recipes?id=eq.<id>`
  (delete the recipe's `recipe_ingredients` first in your call path).
- **Ingredient linking:** `recipe_ingredients.recipe_id → recipes.id`;
  `stock_item_id` left NULL for new rows (stock linking is done in the app UI).
- **Dedup by name:** fetch `recipes?select=name`, lowercase + trim, skip incoming
  names that already exist.
- **Authoritative row count:** read the `Content-Range` header with
  `Prefer: count=exact`. (In PowerShell, `@($rows).Count` mis-reports an empty
  result as `1` because `@($null).Count == 1` — don't trust it for counts.)
- **Backups:** before any bulk change, export the six tables to a timestamped
  folder under `.local\backups\<timestamp>\` (git-ignored) with a
  `backup-manifest.json` (row counts, project ref, per-file SHA-256).

### Database readiness (verified 2026-07-20)

- **Baseline = final counts** (no residue after tests): recipes **28**,
  recipe_ingredients **266**, stock_items 170, meal_plan 7, grocery_extra_items 0,
  grocery_dismissed_items 8.
- **Recipe CRUD** verified — create / update-theme / delete, via the API and
  through the app's Add/Edit Recipe modal (accepted theme).
- **Ingredient CRUD** verified — insert / read-back / update-quantity / delete,
  `stock_item_id` null.
- **Latest backup:** `.local\backups\20260720-220633\` (+ `backup-manifest.json`).
- **Bulk imports still require application-side deduplication** (dedupe incoming
  recipes by name against the existing set before inserting).
- **PostgREST is not one transaction across recipe + ingredient inserts** — the
  recipe insert and its ingredient inserts are separate requests; a failure after
  the recipe insert can leave a recipe with no ingredients. Clean up or retry.

## 4. Application structure

- `index.html` — the whole app: markup + inline `<style>` + inline `<script>`
  (Supabase client, render/CRUD logic). **Authoritative application source.**
- `ui-cards.js` — collapsed-card grid + expand/collapse for the Recipes, Cook Now,
  and Grocery tabs; loaded before the inline script.
- `server.js` — dependency-free Node static server, port 8000.
- `config.js` — git-ignored; Supabase URL + anon key (template `config.example.js`).
- `check-fw.ps1`, `check-node.ps1`, `start-tracker.bat` — original repo helpers (unchanged).

**Theme list:** defined once as `const THEMES = […]` in `index.html`. It feeds
three selectors: the recipe modal dropdown (`#f-recipe-theme`), the recipe filter
(`#recipe-filter-theme`), and the meal-plan day theme dropdown (`.plan-theme`).
Change the list in that one place. Reminder: the DB `recipes_theme_check`
constraint must include any value the dropdown offers, or saving is rejected (§2).

**Recipe JSON import shape** (format to hand a batch of recipes in):

```json
[
  {
    "name": "Chicken Fajitas",
    "theme": "Mexican",
    "instructions": "Step one.\nStep two.",
    "notes": "Serves 4.",
    "ingredients": [ { "name": "Chicken breast", "quantity": "1 lb" } ]
  }
]
```
Required: `name`. Optional: `theme` (a valid DB value or omitted), `instructions`,
`notes`, `ingredients[]` (each `name` required, `quantity` optional).

**Readiness / pantry-stock matching:** the "Cook Now" tab ranks recipes by how
many of their tracked ingredients are marked `OK` in stock. Matching is via
`recipe_ingredients.stock_item_id → stock_items`; ingredients with no
`stock_item_id` are "untracked" and cannot be auto-checked.

## 5. Offline development harness

Reusable tooling in `tools/offline-harness/` (`extract.py`, `local-db.js`,
`serve.py`, `schema.sql`, `README.md`). The runnable snapshot (household data +
offline app copy) is git-ignored under `.local\pantry-snapshot\`.

- **Run offline:** `cd D:\DEV\GalleyQuest\.local\pantry-snapshot && python serve.py` → `http://localhost:8001`.
- **Regenerate from live app:** `python tools\offline-harness\extract.py` (needs network to `http://aet-w11l.local:8000/`; writes into `.local\pantry-snapshot\`).
- Details + shim limitations: `tools/offline-harness/README.md`.

## 6. Migration history (PANTRY → GalleyQuest)

- **Prior harness:** `D:\DEV\PANTRY` — a local-only (no remote) offline fork of
  the live app, branch `tweaks`, HEAD `2cc162a` at retirement. Held the offline
  harness, a data snapshot, ClearWright governance artifacts, and the card-grid
  work that was ported into GalleyQuest.
- **Migrated (tracked) here:** reusable offline-harness tooling →
  `tools/offline-harness/` (`extract.py` repointed to the new snapshot path,
  `local-db.js`, `serve.py`, `schema.sql`); this handoff; the retirement manifest.
- **Retained local-only (git-ignored, `.local\pantry-snapshot\`):** the runnable
  offline harness + data snapshot — `seed.js`, `data/*.json`, offline
  `index.html`/`app.js`/`styles.css`, `original.html`. Contains household data and
  the anon key (`original.html`, `app.js`); never committed.
- **Left only in the archive:** PANTRY's ClearWright artifacts (`tools/cw-*`),
  CW support scripts (`make_excerpts.py`, `scan_check.py`, `verify_readme.py`),
  and the duplicate `ui-cards.js` (byte-identical to GalleyQuest's authoritative
  copy). Reason: historical/duplicate, not operationally useful.
- **Archive:** `D:\DEV\_archives\PANTRY-pre-consolidation-20260720-203016.zip`
  (full `.git` history included; SHA-256 in `docs/PANTRY_RETIREMENT_MANIFEST.md`).
- **PANTRY retirement date:** 2026-07-20 — the `D:\DEV\PANTRY` directory is
  removed after archive + migration verification pass.

## 7. Evidence & unknowns

- **Evidence:** `tools/offline-harness/extract.py` and `schema.sql`; the retired
  PANTRY `README.md` (copied to `.local\pantry-snapshot\PANTRY-README.md`); live
  PostgREST responses (row counts via `Content-Range`, the `recipes_theme_check`
  400, the anon JWT `role` claim, admin-RPC 404 probes); `git` state of both repos.
- **UNKNOWN:** exact RLS policy definitions; provenance of the original recipes
  beyond "authored in the live app" (owner's own data, not scraped); how/when
  PANTRY reached HEAD `2cc162a` (archived as-is); any DDL path — none exists with
  the access available locally.
