"""Keep each module's label, portrait, preview, and page identity aligned."""
import re
import unittest
from atlas_orchestrator.api import STATIC_ROUTES, WEB_ROOT

IDENTITIES = {
    "home": "vesta", "energy": "sol", "environment": "aeolus",
    "security": "titan", "pantry": "demeter", "travel": "oracle",
    "maintenance": "vulcan", "systems": "athena", "agents": "olympus",
}

class IdentityTests(unittest.TestCase):
    def test_unique_module_portraits_and_labels(self):
        html = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(len(set(IDENTITIES.values())), len(IDENTITIES))
        for module, identity in IDENTITIES.items():
            with self.subTest(module=module):
                candidates = re.findall(r'<button[^>]*data-tab-target="' + module + r'"[^>]*>.*?</button>', html)
                tile = next(candidate for candidate in candidates if 'class="greek-association"' in candidate)
                route = f"/assets/greek/{identity}.png"
                self.assertIn(f'src="{route}"', tile)
                self.assertIn(f"<b>{identity.title()}</b>", tile)
                self.assertEqual(STATIC_ROUTES[route], WEB_ROOT / "greek" / f"{identity}.png")
                self.assertTrue(STATIC_ROUTES[route].read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_changed_page_and_preview_identities(self):
        html = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
        javascript = (WEB_ROOT / "atlas.js").read_text(encoding="utf-8")
        for module in ("environment", "pantry", "systems", "maintenance"):
            title = f"{IDENTITIES[module].upper()} · {module.upper()}"
            self.assertIn(f"<h1>{title}</h1>", html)
            self.assertIn(f'{module}: ["{title}"', javascript)
        for stale in ("VESTA · ENVIRONMENT", "VESTA · PANTRY", "VULCAN · SYSTEMS"):
            self.assertNotIn(stale, html + javascript)
