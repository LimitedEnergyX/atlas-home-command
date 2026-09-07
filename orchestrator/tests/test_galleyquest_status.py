from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.targets.galleyquest_status import GalleyQuestStatusTarget  # noqa: E402


class GalleyQuestStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.config = Path(self.temporary.name) / "config.js"
        self.config.write_text(
            'window.SUPABASE_URL = "https://example.supabase.co";\n'
            'window.SUPABASE_ANON_KEY = "test-anonymous-credential-1234567890";\n',
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_status_prioritizes_actionable_weekly_counts(self):
        rows = {
            "meal_plan": [
                {"id": "plan-1", "recipe_id": "recipe-1", "meal_name": "Dinner", "day_of_week": "Wednesday", "slot": "Dinner"},
                {"id": "plan-2", "recipe_id": "recipe-2", "meal_name": None, "day_of_week": "Monday", "slot": "Lunch", "recipe": {"name": "Soup"}},
                {"id": "placeholder", "recipe_id": None, "meal_name": None},
            ],
            "grocery_extra_items": [
                {"id": "cart-1", "item_name": "Milk", "notes": ""},
                {"id": "cart-2", "item_name": " milk ", "notes": "duplicate spelling"},
            ],
            "stock_items": [
                {"id": "flour", "name": "Flour", "status": "OK"},
                {"id": "chicken", "name": "Chicken", "status": "OUT"},
                {"id": "lard", "name": "Lard", "status": "OUT"},
                {"id": "shortening", "name": "Shortening", "status": "LOW"},
            ],
            "recipe_ingredients": [
                {"recipe_id": "recipe-1", "stock_item_id": "flour", "ingredient_name": "Flour"},
                {"recipe_id": "recipe-1", "stock_item_id": None, "ingredient_name": "Milk"},
                {"recipe_id": "recipe-1", "stock_item_id": "chicken", "ingredient_name": "Chicken"},
                {"recipe_id": "recipe-2", "stock_item_id": "lard", "ingredient_name": "Lard"},
                {"recipe_id": "recipe-2", "stock_item_id": None, "ingredient_name": "Water"},
            ],
        }

        def reader(_url, key, table, params, _timeout):
            self.assertEqual(key, "test-anonymous-credential-1234567890")
            if table == "meal_plan":
                self.assertNotIn("slot", params["select"].split(","))
            return rows[table]

        result = GalleyQuestStatusTarget(
            self.config,
            reader=reader,
            today=lambda: date(2026, 8, 19),
        ).status()

        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["week_start"], "2026-08-17")
        self.assertEqual(result["missing_ingredients"], 1)
        self.assertEqual(result["missing_scope"], "planned_meals")
        self.assertEqual(result["missing_items"], ["chicken"])
        self.assertEqual(result["cart_items"], 1)
        self.assertEqual(result["cart_items_preview"], ["milk"])
        self.assertEqual(result["meals_planned"], 2)
        self.assertEqual(result["planned_meals"][0], {"name": "Soup", "day": "Monday", "slot": "Lunch"})
        self.assertEqual(result["stock_items"], 4)
        self.assertEqual(result["stock_ok"], 1)
        self.assertEqual(len(result["staples"]), 7)
        self.assertNotIn("credential", str(result).lower())

    def test_staples_group_products_into_household_categories(self):
        staples = GalleyQuestStatusTarget._staples([
            {"name": "2% Milk", "status": "LOW"},
            {"name": "Oat Milk", "status": "OK"},
            {"name": "Eggs", "status": "OUT"},
            {"name": "Unsalted Butter", "status": "OK"},
            {"name": "Peanut Butter", "status": "OK"},
            {"name": "Bread Crumbs", "status": "OK"},
            {"name": "Ground Coffee", "status": "LOW"},
            {"name": "Greek Yogurt", "status": "OK"},
        ])
        states = {item["id"]: item["status"] for item in staples}
        self.assertEqual(states, {
            "milk": "OK",
            "eggs": "OUT",
            "butter": "OK",
            "bread": "UNTRACKED",
            "coffee": "LOW",
            "cereal": "UNTRACKED",
            "yogurt": "OK",
        })
        self.assertNotIn("2% Milk", str(staples))

    def test_missing_config_fails_closed_without_credentials(self):
        result = GalleyQuestStatusTarget(Path(self.temporary.name) / "missing.js").status()
        self.assertEqual(result, {
            "adapter": "galleyquest-status",
            "status": "unavailable",
            "reason": "not_configured",
        })

    def test_windows_vault_environment_credential_overrides_file(self):
        observed = {}

        def reader(_url, key, table, _params, _timeout):
            observed[table] = key
            return []

        with patch.dict(
            "os.environ",
            {"ATLAS_GALLEYQUEST_ANON_KEY": "vault-anonymous-credential-1234567890"},
        ):
            result = GalleyQuestStatusTarget(self.config, reader=reader).status()

        self.assertEqual(result["status"], "healthy")
        self.assertEqual(set(observed.values()), {"vault-anonymous-credential-1234567890"})

    def test_reader_failure_is_reported_without_secret_detail(self):
        def reader(_url, _key, _table, _params, _timeout):
            raise RuntimeError("test-anonymous-credential-1234567890")

        result = GalleyQuestStatusTarget(self.config, reader=reader).status()
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "RuntimeError")
        self.assertNotIn("test-anonymous", str(result))


if __name__ == "__main__":
    unittest.main()
