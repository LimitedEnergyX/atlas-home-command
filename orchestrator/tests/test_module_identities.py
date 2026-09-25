"""Keep each module's label, portrait, preview, and page identity aligned."""
import re
import unittest
from atlas_orchestrator.api import STATIC_ROUTES, WEB_ROOT

IDENTITIES = {
    "home": "vesta", "energy": "sol", "environment": "aeolus",
    "security": "titan", "pantry": "demeter", "travel": "oracle",
    "argo": "argo", "maintenance": "vulcan", "systems": "daedalus", "agents": "olympus",
}

class IdentityTests(unittest.TestCase):
    def test_unique_module_portraits_and_labels(self):
        html = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(len(set(IDENTITIES.values())), len(IDENTITIES))
        for module, identity in IDENTITIES.items():
            with self.subTest(module=module):
                if module == "agents":
                    # Agents remains in the rail, not in the nine-card Home grid.
                    self.assertIn('data-tab="agents"', html)
                    continue
                candidates = re.findall(r'<button[^>]*data-tab-target="' + module + r'"[^>]*>.*?</button>', html)
                tile = next(candidate for candidate in candidates if 'class="greek-association"' in candidate)
                extension = "svg" if identity in {"argo", "daedalus"} else "png"
                route = f"/assets/greek/{identity}.{extension}"
                self.assertIn(f'src="{route}"', tile)
                self.assertIn(f"<b>{identity.title()}</b>", tile)
                self.assertEqual(STATIC_ROUTES[route], WEB_ROOT / "greek" / f"{identity}.{extension}")
                signature = STATIC_ROUTES[route].read_bytes()
                self.assertTrue(signature.startswith(b"<svg") if extension == "svg" else signature.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_changed_page_and_preview_identities(self):
        html = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
        javascript = (WEB_ROOT / "atlas.js").read_text(encoding="utf-8")
        for module in ("environment", "pantry", "systems", "argo", "maintenance"):
            domain = "vehicles" if module == "argo" else module
            title = f"{IDENTITIES[module].upper()} · {domain.upper()}"
            self.assertIn(f"<h1>{title}</h1>", html)
        for stale in ("VESTA · ENVIRONMENT", "VESTA · PANTRY", "VULCAN · SYSTEMS"):
            self.assertNotIn(stale, html + javascript)
