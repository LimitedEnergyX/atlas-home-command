from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


GalleyQuestReader = Callable[[str, str, str, dict[str, str], float], list[dict[str, Any]]]
TodayProvider = Callable[[], date]


class GalleyQuestStatusTarget:
    name = "galleyquest-status"
    writable = False
    always_on_hand = {
        "water",
        "ice",
        "cold water",
        "warm water",
        "hot water",
        "boiling water",
        "tap water",
        "ice water",
        "ice cube",
        "cold running water",
    }
    substitute_groups = (
        ("lard", "shortening"),
        ("vegetable oil", "sunflower oil"),
        ("corn starch", "potato starch"),
        ("bell pepper", "green pepper", "red pepper", "yellow pepper"),
    )
    staple_categories = (
        ("milk", "Milk", (r"\bmilk\b",), (r"\bcoconut milk\b", r"\bcondensed milk\b", r"\bevaporated milk\b", r"\bpowdered milk\b", r"\bbuttermilk\b")),
        ("eggs", "Eggs", (r"\beggs?\b",), (r"\beggplant\b", r"\begg noodles?\b")),
        ("butter", "Butter", (r"\bbutter\b",), (r"\bpeanut butter\b", r"\balmond butter\b", r"\bcashew butter\b", r"\bapple butter\b")),
        ("bread", "Bread", (r"\bbread\b",), (r"\bbread crumbs?\b", r"\bbreadcrumbs?\b")),
        ("coffee", "Coffee", (r"\bcoffee\b",), ()),
        ("cereal", "Cereal", (r"\bcereal\b",), ()),
        ("yogurt", "Yogurt", (r"\byogurt\b",), ()),
    )

    def __init__(
        self,
        config_path: Path | None,
        timeout: float = 3.0,
        reader: GalleyQuestReader | None = None,
        today: TodayProvider | None = None,
    ) -> None:
        self.config_path = config_path
        self.timeout = timeout
        self._reader = reader or self._read
        self._today = today or date.today

    def status(self) -> dict[str, Any]:
        if self.config_path is None or not self.config_path.is_file():
            return {"adapter": self.name, "status": "unavailable", "reason": "not_configured"}
        try:
            base_url, anon_key = self._credentials()
            today = self._today()
            week_start = today - timedelta(days=today.weekday())
            week = week_start.isoformat()
            with ThreadPoolExecutor(max_workers=3, thread_name_prefix="atlas-galleyquest") as pool:
                plan_future = pool.submit(
                    self._reader,
                    base_url,
                    anon_key,
                    "meal_plan",
                    {
                        "select": "id,recipe_id,meal_name,day_of_week,theme,recipe:recipes(name)",
                        "week_start_date": f"eq.{week}",
                    },
                    self.timeout,
                )
                cart_future = pool.submit(
                    self._reader,
                    base_url,
                    anon_key,
                    "grocery_extra_items",
                    {"select": "id,item_name,notes", "week_start_date": f"eq.{week}"},
                    self.timeout,
                )
                stock_future = pool.submit(
                    self._reader,
                    base_url,
                    anon_key,
                    "stock_items",
                    {"select": "id,name,status"},
                    self.timeout,
                )
                plan = plan_future.result()
                cart = cart_future.result()
                stock = stock_future.result()

            recipe_ids = sorted(
                {str(row.get("recipe_id")) for row in plan if row.get("recipe_id")}
            )
            ingredients = (
                self._reader(
                    base_url,
                    anon_key,
                    "recipe_ingredients",
                    {
                        "select": "recipe_id,stock_item_id,ingredient_name",
                        "recipe_id": f"in.({','.join(recipe_ids)})",
                    },
                    self.timeout,
                )
                if recipe_ids
                else []
            )
            cart_names = {
                self._normalize(row.get("item_name"))
                for row in cart
                if self._normalize(row.get("item_name"))
            }
            cart_status_counts = self._cart_status_counts(cart)
            missing = self._missing_ingredients(ingredients, stock, cart_names)
            planned_meals = self._planned_meals(plan)
            return {
                "adapter": self.name,
                "status": "healthy",
                "week_start": week,
                "missing_ingredients": len(missing),
                "missing_scope": "planned_meals",
                "missing_items": sorted(missing),
                "cart_items": len(cart_names),
                "cart_items_preview": sorted(cart_names)[:12],
                "cart_status_counts": cart_status_counts,
                "cart_status_label": self._cart_status_label(cart_status_counts),
                "meals_planned": len(planned_meals),
                "planned_meals": planned_meals,
                "stock_items": len(stock),
                "stock_ok": sum(1 for row in stock if row.get("status") == "OK"),
                "staples": self._staples(stock),
                "observed_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            return {"adapter": self.name, "status": "unavailable", "reason": type(exc).__name__}

    def _credentials(self) -> tuple[str, str]:
        source = self.config_path.read_text(encoding="utf-8")
        base_url = self._config_value(source, "SUPABASE_URL").rstrip("/")
        anon_key = os.environ.get("ATLAS_GALLEYQUEST_ANON_KEY") or self._config_value(
            source, "SUPABASE_ANON_KEY"
        )
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("GalleyQuest data endpoint must be credential-free HTTPS")
        if len(anon_key) < 20:
            raise ValueError("GalleyQuest anonymous credential is malformed")
        return base_url, anon_key

    def browser_config(self) -> dict[str, str]:
        """Return the public browser configuration without persisting it to disk."""
        base_url, anon_key = self._credentials()
        return {"supabase_url": base_url, "supabase_anon_key": anon_key}

    @staticmethod
    def _config_value(source: str, name: str) -> str:
        match = re.search(
            rf"(?:window\.)?{re.escape(name)}\s*=\s*(['\"])(.*?)\1",
            source,
        )
        if not match:
            raise ValueError(f"{name} is not configured")
        return match.group(2)

    @classmethod
    def _missing_ingredients(
        cls,
        ingredients: list[dict[str, Any]],
        stock: list[dict[str, Any]],
        cart_names: set[str],
    ) -> set[str]:
        stock_by_id = {str(row.get("id")): row for row in stock if row.get("id")}
        stock_by_name = {
            cls._normalize(row.get("name")): row
            for row in stock
            if cls._normalize(row.get("name"))
        }
        missing: set[str] = set()
        for ingredient in ingredients:
            ingredient_name = cls._normalize(ingredient.get("ingredient_name"))
            if not ingredient_name or ingredient_name in cls.always_on_hand:
                continue
            item = stock_by_id.get(str(ingredient.get("stock_item_id")))
            covered = bool(item and item.get("status") == "OK")
            if not covered and item:
                item_name = cls._normalize(item.get("name"))
                for group in cls.substitute_groups:
                    if item_name not in group:
                        continue
                    covered = any(
                        name != item_name
                        and stock_by_name.get(name, {}).get("status") in {"OK", "LOW"}
                        for name in group
                    )
                    break
            shopping_name = cls._normalize(item.get("name")) if item else ingredient_name
            if not covered and shopping_name not in cart_names:
                missing.add(shopping_name)
        return missing

    @staticmethod
    def _cart_status_counts(cart: list[dict[str, Any]]) -> dict[str, int]:
        counts = {"pending_order": 0, "ordered": 0, "pending_pickup": 0}
        for row in cart:
            note = str(row.get("notes") or "").strip().lower()
            if note.startswith("[pending_pickup]"):
                counts["pending_pickup"] += 1
            elif note.startswith("[ordered]"):
                counts["ordered"] += 1
            else:
                counts["pending_order"] += 1
        return counts

    @staticmethod
    def _cart_status_label(counts: dict[str, int]) -> str:
        if counts["pending_pickup"]:
            return f'{counts["pending_pickup"]} Pending Pickup'
        if counts["ordered"]:
            return f'{counts["ordered"]} Ordered'
        if counts["pending_order"]:
            return f'{counts["pending_order"]} Pending Order'
        return "Cart Empty"

    @staticmethod
    def _normalize(value: Any) -> str:
        return str(value or "").strip().lower()

    @classmethod
    def _staples(cls, stock: list[dict[str, Any]]) -> list[dict[str, Any]]:
        staples: list[dict[str, Any]] = []
        priority = {"OK": 3, "LOW": 2, "OUT": 1}
        for staple_id, label, includes, excludes in cls.staple_categories:
            matches = []
            for row in stock:
                name = cls._normalize(row.get("name"))
                if not name or not any(re.search(pattern, name) for pattern in includes):
                    continue
                if any(re.search(pattern, name) for pattern in excludes):
                    continue
                matches.append(str(row.get("status") or "").upper())
            status = max(matches, key=lambda value: priority.get(value, 0)) if matches else "UNTRACKED"
            staples.append({"id": staple_id, "name": label, "status": status, "tracked": bool(matches)})
        return staples

    @staticmethod
    def _planned_meals(plan: list[dict[str, Any]]) -> list[dict[str, str]]:
        day_order = {
            name: index
            for index, name in enumerate(
                ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
            )
        }
        meals: list[dict[str, str]] = []
        for row in plan:
            if not row.get("recipe_id") and not row.get("meal_name"):
                continue
            recipe = row.get("recipe") if isinstance(row.get("recipe"), dict) else {}
            name = str(row.get("meal_name") or recipe.get("name") or row.get("theme") or "Planned Meal").strip()
            meals.append(
                {
                    "name": name,
                    "day": str(row.get("day_of_week") or "This Week"),
                    "slot": str(row.get("slot") or "Meal"),
                }
            )
        return sorted(
            meals,
            key=lambda meal: (day_order.get(meal["day"], 7), meal["slot"], meal["name"]),
        )

    @staticmethod
    def _read(
        base_url: str,
        anon_key: str,
        table: str,
        params: dict[str, str],
        timeout: float,
    ) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode(params, safe="(),.*")
        request = urllib.request.Request(
            f"{base_url}/rest/v1/{table}?{query}",
            headers={
                "apikey": anon_key,
                "Authorization": f"Bearer {anon_key}",
                "Accept": "application/json",
                "Range": "0-1999",
                "User-Agent": "Atlas-GalleyQuest-Status/1",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError("GalleyQuest response is too large")
        payload = json.loads(body)
        if not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
            raise ValueError("GalleyQuest response must be a list of objects")
        return payload
