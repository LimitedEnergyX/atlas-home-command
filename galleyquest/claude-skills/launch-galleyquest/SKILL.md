---
name: launch-galleyquest
description: "Launch GalleyQuest" — fill the operator's Store A Example Region curbside pickup cart from the current GalleyQuest grocery list, in their own Chrome, then mark the items ordered. Stops before checkout.
---

# Launch GalleyQuest (Store A Example Region pickup)

Fill the operator's Store A curbside cart from the current GalleyQuest grocery list.

## Hard rules

- Never check out, place the order, enter payment, enter a password, or solve a CAPTCHA.
- Only add items on the current GalleyQuest list. Purchase history chooses the product; it does not add items to the list.
- Store is Store A Example Region, TX; fulfillment is curbside pickup.
- Use the operator's real Chrome through Claude-in-Chrome. Pause for operator sign-in or bot checks.

## Workflow

1. Read the list:

   `python D:/DEV/GalleyQuest/tools/recipe-maintenance/grocery_cli.py list`

2. Open Store A in the operator's Chrome and verify Example Region curbside and signed-in state.
3. Open Buy It Again / Order Again before searching. Cross-reference every current list item and prefer the exact product previously purchased when it is an ingredient equivalent.
4. Match by ingredient meaning, not exact text. Ignore brand, package-size, plural, and preparation words. Treat bell pepper / green bell pepper / green pepper; celery / celery stalk / celery hearts; scallion / spring onion / green onion; prawn / shrimp; and cornstarch / corn starch as equivalent. Do not blur genuinely different ingredients such as poblano vs bell pepper or buttermilk vs milk.
5. Search only the unmatched list items. Choose sensible Store A/store-brand everyday products, recording added, substituted, and unavailable items.
6. Mark only items actually added:

   `python D:/DEV/GalleyQuest/tools/recipe-maintenance/grocery_cli.py mark ordered <id1> <id2> ...`

7. Report the cart, rough total, substitutions, and unavailable items. Stop before checkout so the operator can review, select pickup, and pay.
