---
name: reconcile-galleyquest
description: Reconcile a completed Store A curbside pickup into GalleyQuest stock. Match receipt lines to the GalleyQuest cart first, close fulfilled cart items, then update existing stock or create only reviewed genuinely new items.
---

# Reconcile GalleyQuest from Store A

Use the operator's real Chrome only to read the completed Store A order. Use the
local GalleyQuest command for every inventory mutation. Do not use the browser
Paste receipt tool or call `window.supabase` directly.

## Safety

- Never enter a password, payment data, or solve a CAPTCHA; pause for the operator.
- Use fulfilled pickup quantities and accepted substitutions only. Exclude cancelled, refunded, substituted-away, shorted, and out-of-stock lines.
- Never guess an ambiguous product match or unit conversion.
- Never read, print, or edit `config.js`.

## Workflow

1. Open Atlas Pantry at `http://<atlas-lan-address>/#pantry` for current household context. The full GalleyQuest editor is available at `http://<atlas-lan-address>/galleyquest/?tab=stock`.
2. In Store A, open the completed pickup. Record its stable order ID, pickup date, actual fulfilled product names, quantities, and accepted substitutions. Pickups from the last 30 days are supported; use the most recent unreconciled order unless the operator names another.
   Order `Store A210059502720953344` from 2026-08-17 was reconciled manually during the first trial and must not be processed again.
3. Write a temporary JSON file under `D:/DEV/GalleyQuest/.local/`:

   `{"orders":[{"order_id":"...","pickup_date":"YYYY-MM-DD","items":[{"name":"actual fulfilled product","quantity":2,"unit":"item"}]}]}`

4. Preview with one command:

   `& "D:/DEV/GalleyQuest/reconcile-receipt.ps1" "<json-file>"`

5. Review the result in this order:
   - receipt line matches the GalleyQuest cart item;
   - the cart name matches the existing stock row;
   - only receipt lines left unmatched are fuzzily compared with all stock;
   - only after both searches fail may an item be created.

6. For a genuinely new item, add `"create":true`, a clean `"stock_name"`, and a reviewed `"category"` to that item. Valid categories are `produce`, `bakery`, `deli_prepared`, `meat_seafood`, `dairy_eggs`, `frozen`, `pantry_dry_goods`, `canned_goods`, `condiments_spices`, `snacks`, `beverages`, and `other`. Preview again. Never mark an ambiguous item as new merely to make the run pass.
7. Apply only when `problems` is empty. If the operator explicitly chooses to
   postpone a receipt leftover, add `"defer":true` to that item and preview
   again. Deferred lines remain unchanged and are reported in `skipped`.

   `& "D:/DEV/GalleyQuest/reconcile-receipt.ps1" "<json-file>" -Apply`

   Apply backs up GalleyQuest, updates or creates stock, closes matched cart rows,
   and records fingerprints so the same order cannot be double-counted.
8. Report the order, cart rows closed, stock quantities updated, new stock items,
   already-reconciled lines, and deferred problems. Keep Store A on the completed
   order summary for operator review.
