from __future__ import annotations

import json
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from atlas_orchestrator.api import AtlasHTTPServer  # noqa: E402
from atlas_orchestrator.config import Settings  # noqa: E402
from atlas_orchestrator.core import AtlasOrchestrator  # noqa: E402


class ShellTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        core = AtlasOrchestrator(Settings(Path(self.temporary.name), retry_budget=0))
        self.server = AtlasHTTPServer(("127.0.0.1", 0), core)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def get(self, path: str):
        with urllib.request.urlopen(self.base + path, timeout=2) as response:
            return response.status, response.headers, response.read()

    def test_system_health_checks_native_travel_through_atlas(self):
        config = json.loads((ROOT / "config" / "atlas-status.json").read_text(encoding="utf-8"))
        travel = next(item for item in config["services"] if item["id"] == "travel")
        self.assertEqual(travel["url"], "http://127.0.0.1:8080/v1/travel")
        self.assertTrue(travel["required"])
        self.assertTrue(travel["critical"])

    def test_shell_route_is_product_specific(self):
        status, headers, body = self.get("/")
        page = body.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "text/html")
        self.assertIn("Atlas · Household Command", page)
        self.assertIn('id="panel-systems"', page)
        self.assertIn('data-tab="pantry"', page)
        self.assertIn('data-tab="environment"', page)
        self.assertIn('id="panel-environment"', page)
        self.assertIn('id="panel-argo"', page)
        self.assertNotIn("http://", page)
        self.assertEqual(page.count("https://"), 2)
        self.assertEqual(page.count("https://radar.weather.gov/"), 2)

    def test_shell_assets_are_local_and_typed(self):
        _, css_headers, css = self.get("/assets/atlas.css")
        _, js_headers, javascript = self.get("/assets/atlas.js")
        _, openai_headers, openai = self.get("/assets/openai.svg")
        _, image_headers, artwork = self.get("/assets/atlas-home-overall.png")
        _, profile_headers, profile = self.get("/assets/profile.svg")
        _, favicon_headers, favicon = self.get("/favicon.ico")
        self.assertEqual(css_headers.get_content_type(), "text/css")
        self.assertIn("javascript", js_headers.get_content_type())
        self.assertEqual(openai_headers.get_content_type(), "image/svg+xml")
        self.assertEqual(image_headers.get_content_type(), "image/png")
        self.assertEqual(profile_headers.get_content_type(), "image/svg+xml")
        self.assertEqual(favicon_headers.get_content_type(), "image/svg+xml")
        self.assertIn(b"--cyan", css)
        self.assertIn(b"/v1/atlas/status", javascript)
        self.assertNotIn(b"/v1/jarvis/status", javascript)
        self.assertIn(b"<svg", openai)
        self.assertTrue(artwork.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(artwork), 1_000_000)
        self.assertIn(b"<svg", profile)
        self.assertIn(b"<svg", favicon)

    def test_responsive_home_artwork_and_navigation_icons_are_local(self):
        _, desktop_headers, desktop = self.get("/assets/heroes/atlas-home-desktop.png")
        _, mobile_headers, mobile = self.get("/assets/heroes/atlas-home-mobile.png")
        _, icon_headers, icon = self.get("/assets/icons/environment-weather.svg")
        _, sol_headers, sol = self.get("/assets/greek/sol.png")
        self.assertEqual(desktop_headers.get_content_type(), "image/png")
        self.assertEqual(mobile_headers.get_content_type(), "image/png")
        self.assertEqual(icon_headers.get_content_type(), "image/svg+xml")
        self.assertEqual(sol_headers.get_content_type(), "image/png")
        self.assertGreater(len(desktop), 1_000_000)
        self.assertGreater(len(mobile), 500_000)
        self.assertGreater(len(sol), 800_000)
        self.assertIn(b"currentColor", icon)

    def test_shell_keeps_profile_access_without_redundant_identity_copy(self):
        _, _, body = self.get("/")
        page = body.decode("utf-8")
        self.assertEqual(page.count('data-profile-id="alex"'), 1)
        self.assertEqual(page.count('aria-label="Current local profile: Alex"'), 1)
        self.assertNotIn('class="profile-copy"', page)
        self.assertNotIn("Local only", page)
        self.assertNotIn("LOCAL ONLY", page)

    def test_household_profiles_support_sam_kitchen_mode_and_alex_pin_switch(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        _, _, css = self.get("/assets/atlas.css")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        stylesheet = css.decode("utf-8")
        self.assertIn('id="profile-pin"', page)
        self.assertIn('/v1/household/profile/switch', source)
        self.assertIn('document.body.dataset.profile = profile.id;', source)
        self.assertIn('body[data-profile="sam"] .home-artwork { width: 100%; }', stylesheet)
        self.assertNotIn('data-alex-home', page)

    def test_home_removes_quick_light_preview_without_removing_control_api(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertIn('id="quick-light-controls"', page)
        self.assertNotIn('<h3 id="quick-lights-title">Lights</h3>', page)
        self.assertIn('function renderQuickLights()', source)
        self.assertIn('"light.main_hall_light"', source)
        self.assertIn('"light.entry_light_left"', source)
        self.assertIn('"light.entry_light_right"', source)
        self.assertIn('allName.textContent = "All Lights"', source)
        self.assertIn('darkState.textContent = "Go Dark"', source)
        self.assertIn('async function setAllLights(items, enabled, button)', source)
        self.assertIn('for (const item of pending)', source)
        self.assertNotIn('Promise.all(pending.map', source)
        self.assertNotIn('return shortened || "Kitchen Plug"', source)
        self.assertIn('/v1/home/controls', source)

    def test_brand_mark_returns_to_home(self):
        _, _, body = self.get("/")
        page = body.decode("utf-8")
        self.assertIn('class="brand-mark brand-home"', page)
        self.assertIn('data-tab-target="home"', page)
        self.assertIn('aria-label="Return to Atlas home"', page)

    def test_home_artwork_exposes_clickable_live_module_tiles(self):
        _, _, body = self.get("/")
        page = body.decode("utf-8")
        self.assertIn('class="home-canvas"', page)
        self.assertNotIn('id="home-preview"', page)
        self.assertNotIn('id="open-preview"', page)
        home = page.split('id="panel-home"', 1)[1].split('id="home-control-overlay"', 1)[0]
        self.assertIn('id="home-hvac"', home)
        self.assertIn('quick-light-controls', home)
        self.assertNotIn("Household highlights", page)
        self.assertNotIn("Select a module", page)
        for module in ("energy", "environment", "security", "pantry", "travel", "argo", "maintenance", "systems"):
            self.assertIn(f'data-tab-target="{module}"', page)
        self.assertIn('class="home-module-grid"', page)
        stylesheet = self.get("/assets/atlas.css")[2].decode("utf-8")
        tiles = page.split('class="home-module-grid"', 1)[1].split('</nav>', 1)[0]
        self.assertEqual(tiles.count('class="greek-association"'), 9)
        self.assertNotIn('class="nav-icon ', tiles)
        self.assertIn('width: clamp(3.5rem, 30cqw, 7rem)', stylesheet)
        self.assertIn('.home-module-grid button > .nav-icon { display: none; }', stylesheet)
        self.assertNotIn('/assets/heroes/atlas-home-standard.png', page)
        self.assertNotIn('/assets/heroes/atlas-home-mobile.png', page)
        self.assertIn('/assets/heroes/atlas-home-desktop.png', page)
        self.assertIn('rel="icon" type="image/svg+xml" href="/favicon.ico"', page)
        self.assertNotIn('class="tile-hotspots"', page)
        self.assertNotIn('class="rail-hotspots"', page)
        self.assertNotIn('class="module-grid"', page)
        self.assertIn(b"/v1/energy/status", self.get("/assets/atlas.js")[2])
        self.assertIn(b"/v1/home/status", self.get("/assets/atlas.js")[2])
        self.assertIn(b"/v1/home/hvac", self.get("/assets/atlas.js")[2])
        self.assertIn(b"/v1/home/environment/history", self.get("/assets/atlas.js")[2])
        self.assertNotIn(b'data-camera-image=', body)
        self.assertNotIn(b"8123", self.get("/assets/atlas.js")[2])
        self.assertIn(b'failure.status !== "monitoring"', self.get("/assets/atlas.js")[2])
        self.assertIn(b"data-galleyquest-tab", body)
        self.assertIn(b"/galleyquest/?tab=", self.get("/assets/atlas.js")[2])
        self.assertNotIn(b"householdUrl(8000", self.get("/assets/atlas.js")[2])

    def test_agents_page_embeds_native_local_first_chat(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertIn('id="agent-chat-form"', page)
        self.assertIn('id="agent-transcript"', page)
        self.assertIn('id="agent-route-status"', page)
        self.assertIn('<h1>Chat with Atlas</h1>', page)
        self.assertNotIn("Shift+Enter for a new line", page)
        self.assertNotIn("Cloud comparison is never automatic", page)
        self.assertIn('fetch("/v1/chat"', source)
        self.assertIn('event.key !== "Enter" || event.shiftKey || event.isComposing', source)
        self.assertIn('requestSubmit()', source)
        self.assertIn('mode: "auto"', source)
        self.assertIn('No cloud spend', page)
        self.assertIn('trigger.addEventListener("click", () => activateTab(trigger.dataset.tabTarget, true))', source)

    def test_camera_surfaces_are_removed_while_ring_is_isolated(self):
        page = self.get("/")[2].decode()
        source = self.get("/assets/atlas.js")[2].decode()
        self.assertNotIn("data-camera-image=", page)
        self.assertNotIn("data-security-camera=", page)
        self.assertNotIn('class="home-camera-shortcut"', page)
        self.assertNotIn('data-preview-action="cameras"', page)
        self.assertNotIn("chatgpt-voice", page)
        self.assertNotIn("data-agent-voice", page)
        self.assertNotIn("async function startCameraLive()", source)
        self.assertNotIn("/webrtc", source)
        self.assertNotIn("cameraFallbackReason", source)
        self.assertNotIn("RTCPeerConnection", source)


    def test_environment_control_and_full_page_use_native_atlas_data(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertIn("Temperature Control", source)
        self.assertIn("Current Temperature", page)
        self.assertIn("Target Temperature", page)
        self.assertIn('id="environment-snapshot"', page)
        self.assertIn('id="view-environment"', page)
        self.assertIn('id="temperature-history-chart"', page)
        self.assertIn('id="humidity-history-chart"', page)
        self.assertIn('activateTab("environment", true)', source)
        self.assertNotIn("Daikin main room", page)
        self.assertNotIn("Daikin main room", source)

    def test_energy_page_uses_powerwall_financials_history_and_cycle_dates(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertIn('id="energy-financial-list"', page)
        self.assertIn('id="energy-cycle-range"', page)
        self.assertIn('id="energy-history-chart"', page)
        _, _, calendar_javascript = self.get("/assets/energy-ui.js")
        self.assertIn('/v1/energy/calendar', calendar_javascript.decode("utf-8"))
        self.assertIn('data-energy-view="solar"', page)
        self.assertIn('id="energy-period"', page)
        self.assertIn('Billing-cycle estimates', page)
        css = self.get("/assets/atlas.css")[2].decode("utf-8")
        self.assertIn('#panel-energy { max-width: 100rem; }', css)
        self.assertIn('class="energy-layout"', page)
        self.assertIn('class="energy-sidebar"', page)
        self.assertLess(page.index('id="energy-history-chart"'), page.index('class="energy-sidebar"'))
        self.assertIn('.energy-layout { grid-template-columns: minmax(0, 1.65fr)', css)
        self.assertIn('monthly.projected_import_kwh', source)

    def test_security_page_keeps_primary_alarm_separate_and_ids_confirmed(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertIn('id="panel-security"', page)
        self.assertIn("Primary monitored alarm remains standalone", page)
        self.assertEqual(page.count('data-security-camera='), 0)
        self.assertIn('id="ids-arm"', page)
        self.assertIn('id="ids-confirm" hidden', page)
        self.assertIn('/v1/security/vacation-ids', source)
        self.assertIn('setVacationIDS(true, "ARM VACATION IDS")', source)

    def test_systems_page_has_searchable_minimized_home_assistant_inventory(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertIn('id="entity-search"', page)
        self.assertIn('id="entity-category"', page)
        self.assertIn('id="entity-list"', page)
        self.assertIn('/v1/home/entities', source)
        self.assertNotIn('attributes.', source)

    def test_galleyquest_summary_is_native_with_same_origin_editor_access(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertIn('id="panel-pantry"', page)
        self.assertIn('class="pantry-metric-grid"', page)
        self.assertIn('id="pantry-meal-list"', page)
        self.assertIn('id="pantry-missing-list"', page)
        self.assertIn('id="pantry-cart-list"', page)
        self.assertIn('id="pantry-staple-list"', page)
        self.assertIn('Household Staples', page)
        self.assertNotIn('Pantry Coverage', page)
        self.assertNotIn('id="pantry-stock-percent"', page)
        self.assertIn('data-galleyquest-tab="stock"', page)
        self.assertIn('if (name === "pantry") renderPantryPage();', source)
        self.assertIn('/galleyquest/?tab=', source)
        self.assertIn('activateTab("pantry", true)', source)
        self.assertNotIn('<iframe', page)
        self.assertNotIn('galleyquest-frame', source)

    def test_pantry_uses_live_actionable_galleyquest_status(self):
        _, _, javascript = self.get("/assets/atlas.js")
        source = javascript.decode("utf-8")
        self.assertIn('/v1/galleyquest/status', source)
        self.assertIn('function pantryStatusCopy()', source)
        self.assertIn('`${missing} Missing`', source)
        self.assertIn('For Planned Meals', source)
        self.assertIn('Items In Cart', self.get("/")[2].decode("utf-8"))
        self.assertIn('Meals Planned', source)
        self.assertIn('function renderPantryStaples(values)', source)
        self.assertIn('["OK", "LOW"].includes', source)
        self.assertNotIn('galleyquest?.status === "healthy" ? "Ready"', source)

    def test_home_uses_full_real_artwork_with_core_status_at_the_bottom(self):
        _, _, body = self.get("/")
        _, _, css = self.get("/assets/atlas.css")
        page = body.decode("utf-8")
        stylesheet = css.decode("utf-8")
        self.assertIn('/assets/heroes/atlas-home-desktop.png', page)
        self.assertNotIn('<source media="(max-width: 820px)"', page)
        self.assertIn('object-position: left top; transform: none;', stylesheet)
        self.assertNotIn('/assets/heroes/atlas-home-standard.png', page)
        self.assertIn('.home-artwork { position: absolute; inset: 0 0 16%; width: 100%;', stylesheet)
        self.assertIn('aspect-ratio: 2 / 1;', stylesheet)
        self.assertIn('object-position: right center; transform: translateX(-6%);', stylesheet)
        self.assertIn('class="home-system-state"', page)
        self.assertIn('id="metric-environment"', page)
        self.assertIn('id="metric-environment-note"', page)
        self.assertIn('Indoor Range · AQI', page)
        self.assertLess(page.index('class="home-live-banner"'), page.index('class="home-live-metrics"'))
        self.assertLess(page.index('class="home-stage"'), page.index('class="home-welcome"'))
        self.assertLess(page.index('class="home-welcome"'), page.index('class="home-live-banner"'))
        self.assertIn('grid-template-rows: auto minmax(3rem, 1fr) auto;', stylesheet)
        self.assertIn('height: auto; min-height: 0; grid-template-columns:', stylesheet)
        self.assertIn('width: 4.875rem; height: 4.875rem;', stylesheet)
        self.assertIn('.home-module-grid button > strong, .home-module-grid button > small { width: 100%; text-align: center;', stylesheet)
        self.assertIn('border-radius: 0;', stylesheet)
        self.assertIn('font-size: clamp(1rem, 1.05vw, 1.25rem);', stylesheet)
        self.assertIn('font-size: clamp(1.125rem, 1.15vw, 1.375rem);', stylesheet)
        self.assertIn('-webkit-line-clamp: 2;', stylesheet)
        self.assertIn('overflow-wrap: anywhere;', stylesheet)
        self.assertIn('function homeEnvironmentCompactSummary()', self.get("/assets/atlas.js")[2].decode("utf-8"))
        self.assertIn('top: 22%;', stylesheet)

    def test_native_travel_module_has_trip_readiness_costs_and_guardrails(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        _, _, css = self.get("/assets/atlas.css")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        stylesheet = css.decode("utf-8")
        self.assertIn('class="tab-panel travel-panel"', page)
        self.assertIn('id="travel-detail"', page)
        self.assertIn('id="travel-reservation-list"', page)
        self.assertIn('id="travel-charge-list"', page)
        self.assertIn('id="travel-lounge-list"', page)
        self.assertIn('id="travel-loyalty-view"', page)
        self.assertIn('id="travel-loyalty-list"', page)
        self.assertIn('id="loyalty-lounge-pass-count"', page)
        self.assertIn('Lounge Passes', page)
        self.assertNotIn('Balances verified', page)
        self.assertIn('Programs Tracked', page)
        self.assertIn('Status Verified', page)
        self.assertIn('Progress Tracked', page)
        self.assertIn('Current Balance', source)
        self.assertIn('id="travel-source-list"', page)
        self.assertIn('id="travel-detail-type"', page)
        self.assertIn('id="travel-expense-board" hidden', page)
        self.assertIn('id="travel-expense-submitted"', page)
        self.assertIn('id="travel-expense-reimbursed"', page)
        self.assertIn('id="travel-expense-remaining"', page)
        self.assertIn('id="travel-detail-card"', page)
        self.assertIn('Approve Before Purchase', page)
        self.assertIn('Account passwords stay in the browser or Windows credential storage', page)
        self.assertIn('fetchSnapshot("/v1/travel")', source)
        self.assertIn('function openTravelTrip(tripId, updateHash = true)', source)
        self.assertIn('function openTravelLoyalty(updateHash = true)', source)
        self.assertIn('travel/loyalty', source)
        self.assertIn('trip.business_expenses', source)
        self.assertIn('document.getElementById("travel-expense-board").hidden = !business;', source)
        self.assertIn('function travelEstimatedAmount(value, missingEstimates = 0)', source)
        self.assertIn('Estimated Due Later · ${travelCosts', source)
        self.assertNotIn('due-later amount pending', source)
        self.assertIn('program.balance_label !== "Balance unavailable"', source)
        self.assertIn('<h1>ORACLE · TRAVEL</h1>', page)
        self.assertIn('<h2>Travel Rewards</h2>', page)
        self.assertNotIn('<h1>Travel command</h1>', page)
        self.assertIn('font-size: clamp(1.25rem, 1.8vw, 1.6875rem);', stylesheet)
        self.assertIn('charge.cash_fees', source)
        self.assertIn('id="travel-attention-list"', page)
        self.assertIn('id="travel-case-list"', page)
        self.assertIn('id="travel-monitor-list"', page)
        self.assertIn('id="travel-coverage-list"', page)
        self.assertIn('id="travel-departure-list"', page)
        self.assertNotIn('"Confirmation Pending"', source)
        self.assertNotIn('? "Available"', source)
        self.assertIn('Delta Sky Club, Centurion, Sidecar, Escape Lounge, and USO', source)
        self.assertIn('travel/trip/', source)

    def test_native_travel_api_starts_as_a_healthy_empty_ledger(self):
        status, headers, body = self.get("/v1/travel")
        payload = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "application/json")
        self.assertEqual(payload["status"], "healthy")
        self.assertEqual(payload["summary"]["upcoming"], 0)
        self.assertIsNone(payload["policy"]["preferred_card"])
        self.assertEqual(payload["policy"]["lounge_profile"]["candidate_networks"], [])

    def test_argo_api_exposes_tenant_aware_private_vehicle_records(self):
        status, headers, body = self.get("/v1/argo")
        payload = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "application/json")
        self.assertEqual(payload["tenant"]["id"], 0)
        self.assertEqual(payload["summary"]["vehicles"], 0)
        self.assertEqual(payload["assets"], [])

    def test_travel_review_endpoint_roundtrip_and_origin_guard(self):
        ledger = Path(self.temporary.name) / "travel.json"
        ledger.write_text(json.dumps({"trips": [{"id": "qa", "title": "QA", "start_date": "2099-01-01", "end_date": "2099-01-03",
                       "reservations": [{"type": "Flight", "status": "ticketed", "required": True}], "charges": []}]}), encoding="utf-8")
        revision = json.loads(self.get("/v1/travel")[2])["revision"]
        payload = {"trip_id": "qa", "revision": revision, "confirmed": True, "profile": "alex", "checks": ["bookings", "documents", "costs", "transport"]}
        def request(origin):
            return urllib.request.Request(self.base + "/v1/travel/review", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Origin": origin})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request("https://untrusted.example"))
        self.assertEqual(error.exception.code, 403)
        with urllib.request.urlopen(request(self.base)) as response:
            result = json.load(response)
        self.assertEqual(result["status"], "applied-and-verified")
        self.assertTrue(result["travel"]["trips"][0]["operator_review"]["current"])
        self.assertTrue(json.loads(self.get("/v1/travel")[2])["trips"][0]["departure"]["good_to_go"])

    def test_zero_notice_badges_are_blank_and_hidden(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertIn('id="notification-count" hidden', page)
        self.assertIn('id="home-notification-count" hidden', page)
        self.assertIn('badge.hidden = total === 0;', source)
        self.assertIn('badge.textContent = total ? String(total) : "";', source)

    def test_home_preview_is_removed_and_security_page_remains(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertEqual(page.count('class="preview-card-image"'), 0)
        self.assertNotIn('id="preview-value-5"', page)
        self.assertIn('id="panel-security"', page)
        self.assertIn('function renderSecurityPage()', source)
        self.assertNotIn("scrollIntoView", source)

    def test_security_cyber_uses_dedicated_evidence_not_service_scores(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        _, _, css = self.get("/assets/atlas.css")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        stylesheet = css.decode("utf-8")
        self.assertNotIn('id="security-health-status"', page)
        self.assertNotIn('data-camera-preview="front-door"', page)
        self.assertNotIn('button.classList.toggle("security-cyber-card"', source)
        self.assertIn('fetchSnapshot("/v1/security/cyber")', source)
        self.assertIn('id="cyber-finding-list"', page)
        self.assertIn('id="cyber-coverage-note"', page)
        self.assertIn('Event Sources', source)
        self.assertIn('.home-preview[data-preview="security"] .camera-preview-card { grid-column: auto;', stylesheet)
        self.assertIn('.home-preview[data-preview="security"] .security-cyber-card { grid-column: 1 / -1;', stylesheet)
        self.assertNotIn('.preview-card:nth-of-type', stylesheet)

    def test_direct_navigation_preserves_system_status_counts(self):
        _, _, javascript = self.get("/assets/atlas.js")
        _, _, css = self.get("/assets/atlas.css")
        source = javascript.decode("utf-8")
        stylesheet = css.decode("utf-8")
        self.assertNotIn('selectHomePreview', source)
        self.assertNotIn('renderPreview', source)
        self.assertIn('trigger.addEventListener("click", () => activateTab(trigger.dataset.tabTarget, true))', source)
        self.assertNotIn("PHYSICAL FIRST", source)
        self.assertIn('"All Systems Online"', source)
        self.assertIn('System${requiredSystemsOffline === 1 ? "" : "s"} Offline', source)
        self.assertIn('`Core Online · ${optionalSystemsOffline} Optional Offline`', source)
        self.assertIn('.home-preview-header #preview-summary { display: none; }', stylesheet)
        self.assertNotIn('document.getElementById("preview-eyebrow")', source)

    def test_headings_use_one_title_per_group_across_all_modules(self):
        page = self.get("/")[2].decode("utf-8")
        source = self.get("/assets/atlas.js")[2].decode("utf-8")
        stylesheet = self.get("/assets/atlas.css")[2].decode("utf-8")
        self.assertEqual(re.findall(r'<h1[^>]*>(.*?)</h1>', page), [
            "Calendar",
            "DAEDALUS · SYSTEMS", "SOL · ENERGY", "AEOLUS · ENVIRONMENT",
            "TITAN · SECURITY", "DEMETER · PANTRY", "ORACLE · TRAVEL",
            "ARGO · VEHICLES", "VULCAN · MAINTENANCE", "Chat with Atlas", "Notifications",
        ])
        self.assertNotIn('class="eyebrow"', page)
        for removed_id in ("preview-eyebrow", "control-dialog-eyebrow"):
            self.assertNotIn(f'id="{removed_id}"', page)
            self.assertNotIn(f'getElementById("{removed_id}")', source)
        for title in ("Energy Financials", "24-Hour Trends",
                      "Upcoming Trips", "Reservations", "Charges", "Travel Rewards",
                      "Missing Ingredients", "Grocery Cart", "Atlas PC · Cyber Health"):
            self.assertIn(f'<h2>{title}</h2>', page)
        for heading_id in ("control-dialog-title", "profile-title",
                           "travel-detail-title", "travel-info-title", "travel-review-title",
                           "outdoor-weather-title", "ids-state"):
            self.assertIn(f'id="{heading_id}"', page)
        self.assertIn('<h2 id="travel-detail-title">Trip</h2>', page)
        self.assertNotIn('id="preview-title"', page)
        self.assertIn('font-size: clamp(1.75rem, 3vw, 2.75rem);', stylesheet)
        self.assertIn('white-space: normal; overflow-wrap: break-word; text-wrap: pretty;', stylesheet)

    def test_home_replaces_camera_surfaces_with_environment(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        self.assertEqual(page.count('class="home-camera-shortcut"'), 0)
        self.assertNotIn('class="preview-card camera-summary-card"', page)
        self.assertIn('id="metric-environment"', page)
        self.assertIn('"east-hallway-temperature", "Hall"', source)
        self.assertIn('"office-temperature", "Office"', source)
        self.assertIn('"living-room-temperature", "Living"', source)
        self.assertIn('"primary-bedroom-temperature", "Bedroom"', source)
        self.assertIn('environmentReading("indoor-aqi")', source)
        self.assertIn('function renderCyberHealth()', source)

    def test_shared_module_spacing_keeps_panels_and_actions_separated(self):
        _, _, css = self.get("/assets/atlas.css")
        _, _, javascript = self.get("/assets/atlas.js")
        stylesheet = css.decode("utf-8")
        script = javascript.decode("utf-8")
        self.assertIn(".tab-panel:not(.module-placeholder) > .text-button { margin-top: var(--section-gap); margin-bottom: var(--section-gap); }", stylesheet)
        self.assertIn(".quick-light-strip { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 18px; margin-top: var(--module-gap);", stylesheet)
        self.assertIn(".status-list.compact > .status-item:last-child:nth-child(odd) { grid-column: 1 / -1; }", stylesheet)
        self.assertIn("repeat(auto-fit, minmax(min(100%, 14rem), 20rem));", stylesheet)
        self.assertIn('homeassistant: "Home Assistant"', script)
        self.assertIn('"open webui": "Open WebUI"', script)

    def test_navigation_uses_stateful_svg_icon_system(self):
        _, _, body = self.get("/")
        _, _, css = self.get("/assets/atlas.css")
        page = body.decode("utf-8")
        stylesheet = css.decode("utf-8")
        for name in ("home", "energy", "environment", "security", "pantry", "travel", "maintenance", "systems", "agents", "notifications"):
            self.assertIn(f"icon-{name}", page)
        self.assertIn("mask: var(--icon)", stylesheet)
        self.assertIn(".module-tab.attention", stylesheet)
        self.assertIn(".module-tab.critical", stylesheet)

    def test_environment_opens_with_hourly_weather_and_external_radar(self):
        _, _, body = self.get("/")
        _, _, javascript = self.get("/assets/atlas.js")
        _, _, css = self.get("/assets/atlas.css")
        page = body.decode("utf-8")
        source = javascript.decode("utf-8")
        stylesheet = css.decode("utf-8")
        self.assertIn('id="outdoor-weather-title">Weather Command', page)
        self.assertIn('id="weather-hourly-list"', page)
        self.assertIn('id="weather-daily-list"', page)
        self.assertNotIn('ridge/standard/', page)
        self.assertIn('id="weather-radar-image"', page)
        self.assertIn('Auto-Playing', page)
        self.assertIn('id="open-radar"', page)
        self.assertIn('function renderOutdoorWeather()', source)
        self.assertIn('radarImage.dataset.radarBucket', source)
        self.assertIn('.weather-radar-card { height: 420px;', stylesheet)
        self.assertIn('object-fit: cover; object-position: 42% 43%;', stylesheet)

    def test_shell_has_restrictive_browser_headers(self):
        _, headers, _ = self.get("/")
        policy = headers["Content-Security-Policy"]
        self.assertIn("default-src 'self'", policy)
        self.assertIn("frame-ancestors 'none'", policy)
        self.assertIn("img-src 'self' data: https://radar.weather.gov", policy)
        self.assertIn("frame-src 'none'", policy)
        self.assertNotIn(":8000", policy)
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")

    def test_unlisted_static_paths_are_not_served(self):
        for path in ("/assets/../api.py", "/assets/missing.js"):
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as raised:
                self.get(path)
            self.assertEqual(raised.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
