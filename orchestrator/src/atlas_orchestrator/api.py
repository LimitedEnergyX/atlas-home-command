from __future__ import annotations

import json
import mimetypes
import re
from ipaddress import ip_address, ip_network
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .core import AtlasOrchestrator
from .calendar_view import read_calendar


REQUEST_PATH = re.compile(r"^/v1/requests/([^/]+)$")
ACTION_PATH = re.compile(r"^/v1/actions/([^/]+)/(preview|execute)$")
HOUSEHOLD_READ_PATH = re.compile(r"^/v1/household/messages/(\d+)/read$")
HOUSEHOLD_MESSAGE_PATH = re.compile(r"^/v1/household/messages/(\d+)$")
WEB_ROOT = Path(__file__).with_name("web")
STATIC_ROUTES = {
    "/": WEB_ROOT / "index.html",
    "/favicon.ico": WEB_ROOT / "favicon.svg",
    "/assets/atlas.css": WEB_ROOT / "atlas.css",
    "/assets/atlas.js": WEB_ROOT / "atlas.js",
    "/assets/energy-ui.js": WEB_ROOT / "energy-ui.js",
    "/assets/calendar-ui.js": WEB_ROOT / "calendar-ui.js",
    "/assets/energy-house.svg": WEB_ROOT / "energy-house.svg",
    "/assets/vehicle-example.svg": WEB_ROOT / "vehicle-example.svg",
    "/assets/atlas-house-hilltop.png": WEB_ROOT / "atlas-house-hilltop.png",
    "/assets/model-y.png": WEB_ROOT / "model-y.png",
    "/assets/pickup.png": WEB_ROOT / "pickup.png",
    "/assets/motorcycle.png": WEB_ROOT / "motorcycle.png",
    "/assets/icons/vehicles.svg": WEB_ROOT / "icons" / "vehicles.svg",
    "/assets/greek/argo.svg": WEB_ROOT / "greek" / "argo.svg",
    "/assets/greek/daedalus.svg": WEB_ROOT / "greek" / "daedalus.svg",
    "/argo/": WEB_ROOT / "argo" / "vehicle.html",
    "/argo/vehicle.html": WEB_ROOT / "argo" / "vehicle.html",
    "/assets/maintenance-ui.js": WEB_ROOT / "maintenance-ui.js",
    "/assets/openai.svg": WEB_ROOT / "openai.svg",
    "/assets/atlas-home-overall.png": WEB_ROOT / "heroes" / "atlas-home-desktop.png",
    "/assets/profile.svg": WEB_ROOT / "profile.svg",
    "/assets/heroes/atlas-home-desktop.png": WEB_ROOT / "heroes" / "atlas-home-desktop.png",
    "/assets/heroes/atlas-home-standard.png": WEB_ROOT / "heroes" / "atlas-home-desktop.png",
    "/assets/heroes/atlas-home-tablet.png": WEB_ROOT / "heroes" / "atlas-home-desktop.png",
    "/assets/heroes/atlas-home-mobile.png": WEB_ROOT / "heroes" / "atlas-home-desktop.png",
}

# Explicit assets only. Never serve owner documents or arbitrary directories.
for relative in ("assets/css/site.css", "assets/css/fleet.css", "assets/js/vehicle.js", "assets/js/fleet-shell.js"):
    STATIC_ROUTES[f"/argo/{relative}"] = WEB_ROOT / "argo" / relative

for icon_name in (
    "home",
    "energy",
    "environment-weather",
    "security",
    "pantry",
    "travel",
    "health",
    "maintenance",
    "systems",
    "agents-work",
    "notifications",
    "household-messages",
    "calendar",
    "profile",
):
    STATIC_ROUTES[f"/assets/icons/{icon_name}.svg"] = WEB_ROOT / "icons" / f"{icon_name}.svg"

for identity_name in (
    "atlas",
    "athena",
    "iris",
    "mnemosyne",
    "olympus",
    "oracle",
    "sol",
    "titan",
    "vesta",
    "vulcan",
):
    STATIC_ROUTES[f"/assets/greek/{identity_name}.svg"] = WEB_ROOT / "greek" / f"{identity_name}.svg"

for identity_name in ("vesta", "sol", "aeolus", "titan", "demeter", "oracle", "vulcan", "athena", "olympus"):
    STATIC_ROUTES[f"/assets/greek/{identity_name}.png"] = WEB_ROOT / "greek" / f"{identity_name}.png"


class AtlasHTTPServer(ThreadingHTTPServer):
    # The scheduled-task supervisor may replace a child immediately after an
    # unclean shutdown.  Reuse the listening address so a closed predecessor's
    # TCP state cannot trap the replacement in a bind/restart loop.
    allow_reuse_address = True
    daemon_threads = True
    block_on_close = False

    def __init__(
        self,
        address: tuple[str, int],
        orchestrator: AtlasOrchestrator,
        trusted_networks: tuple[str, ...] = ("127.0.0.0/8", "::1/128"),
        allow_remote_writes: bool = False,
    ) -> None:
        super().__init__(address, AtlasHandler)
        self.orchestrator = orchestrator
        self.trusted_networks = tuple(ip_network(value, strict=False) for value in trusted_networks)
        self.allow_remote_writes = allow_remote_writes

    def client_is_trusted(self, address: str) -> bool:
        client = ip_address(address)
        return any(client.version == network.version and client in network for network in self.trusted_networks)

    @staticmethod
    def client_is_loopback(address: str) -> bool:
        return ip_address(address).is_loopback

    def client_can_write(self, address: str) -> bool:
        return self.client_is_loopback(address) or self.allow_remote_writes


class AtlasHandler(BaseHTTPRequestHandler):
    server: AtlasHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _json_body(self) -> dict[str, Any]:
        content_type = self.headers.get("Content-Type", "")
        if "application/json" not in content_type:
            raise ValueError("Content-Type must be application/json")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > 1_000_000:
            raise ValueError("request body is too large")
        body = self.rfile.read(length)
        value = json.loads(body or b"{}")
        if not isinstance(value, dict):
            raise ValueError("request body must be a JSON object")
        return value

    def _client_permitted(self, write: bool = False) -> bool:
        address = self.client_address[0]
        if not self.server.client_is_trusted(address):
            self._send(HTTPStatus.FORBIDDEN, {"error": "client network is not trusted"})
            return False
        if write and not self.server.client_can_write(address):
            self._send(
                HTTPStatus.FORBIDDEN,
                {"error": "remote writes are disabled by server configuration"},
            )
            return False
        return True

    def _send(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)

    def _send_bytes(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)

    def _send_stream(self, stream: Any, content_type: str) -> None:
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Connection", "close")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.close_connection = True
            while chunk := stream.read(64 * 1024):
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass
        finally:
            stream.close()

    def _household_control_permitted(self) -> bool:
        if not self._client_permitted(write=True):
            return False
        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if origin and (not host or urlsplit(origin).netloc.lower() != host.lower()):
            self._send(HTTPStatus.FORBIDDEN, {"error": "household controls require same-origin access"})
            return False
        return True

    def _send_file(self, path: Path) -> None:
        body = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://radar.weather.gov; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)

    def _send_redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.TEMPORARY_REDIRECT)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def _galleyquest_config(self) -> dict[str, str]:
        target = self.server.orchestrator.targets.get("galleyquest-status")
        if target is None or not hasattr(target, "browser_config"):
            raise RuntimeError("GalleyQuest is not configured")
        return target.browser_config()

    def _send_galleyquest_bytes(self, body: bytes, content_type: str) -> None:
        config = self._galleyquest_config()
        endpoint = urlsplit(config["supabase_url"])
        connect_origin = f"{endpoint.scheme}://{endpoint.netloc}"
        policy = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            f"connect-src 'self' {connect_origin}; "
            "img-src 'self' data:; frame-src 'none'; frame-ancestors 'self'; "
            "base-uri 'self'; form-action 'self'"
        )
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", policy)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)

    def _send_galleyquest(self, request_path: str) -> None:
        # Pantry summaries remain available. Never publish a configuration directory.
        self._send(HTTPStatus.NOT_FOUND, {"error": "Embedded pantry assets are not served by this distribution"})

    def do_GET(self) -> None:
        try:
            if not self._client_permitted():
                return
            request_path = urlsplit(self.path).path
            query = parse_qs(urlsplit(self.path).query)
            if request_path == "/galleyquest":
                self._send_redirect("/galleyquest/")
                return
            if request_path.startswith("/galleyquest/"):
                self._send_galleyquest(request_path)
                return
            static_file = STATIC_ROUTES.get(request_path)
            if static_file is not None:
                self._send_file(static_file)
                return
            if request_path == "/live":
                self._send(HTTPStatus.OK, {"status": "alive"})
                return
            if request_path == "/health":
                self._send(HTTPStatus.OK, self.server.orchestrator.health())
                return
            if request_path == "/v1/status":
                self._send(HTTPStatus.OK, self.server.orchestrator.local_status())
                return
            if request_path == "/v1/atlas/status":
                self._send(HTTPStatus.OK, self.server.orchestrator.atlas_status())
                return
            if request_path == "/v1/security/cyber":
                self._send(HTTPStatus.OK, self.server.orchestrator.cyber_status())
                return
            if request_path == "/v1/jarvis/status":
                self._send(HTTPStatus.OK, self.server.orchestrator.jarvis_status())
                return
            if request_path == "/v1/energy/status":
                self._send(HTTPStatus.OK, self.server.orchestrator.energy_status())
                return
            if request_path == "/v1/energy/forecast":
                self._send(HTTPStatus.OK, self.server.orchestrator.energy_forecast())
                return
            if request_path == "/v1/energy/history":
                self._send(HTTPStatus.OK, self.server.orchestrator.energy_history(query.get("range", ["day"])[0]))
                return
            if request_path == "/v1/calendar":
                self._send(HTTPStatus.OK, read_calendar(self.server.orchestrator.settings.data_dir / "calendar.json"))
                return
            if request_path == "/v1/argo":
                self._send(HTTPStatus.OK, self.server.orchestrator.argo_status())
                return
            if request_path == "/v1/energy/calendar":
                self._send(HTTPStatus.OK, self.server.orchestrator.energy_calendar(query.get("period", ["day"])[0], query.get("date", [""])[0]))
                return
            if request_path == "/v1/home/status":
                self._send(HTTPStatus.OK, self.server.orchestrator.home_status())
                return
            if request_path == "/v1/home/environment/history":
                self._send(HTTPStatus.OK, self.server.orchestrator.home_environment_history())
                return
            if request_path == "/v1/home/entities":
                self._send(HTTPStatus.OK, self.server.orchestrator.home_inventory())
                return
            if request_path == "/v1/security/vacation-ids":
                self._send(HTTPStatus.OK, self.server.orchestrator.vacation_ids_status())
                return
            if request_path == "/v1/galleyquest/status":
                self._send(HTTPStatus.OK, self.server.orchestrator.galleyquest_status())
                return
            if request_path == "/v1/travel":
                self._send(HTTPStatus.OK, self.server.orchestrator.travel_status())
                return
            if request_path == "/v1/maintenance":
                self._send(HTTPStatus.OK, self.server.orchestrator.maintenance.status())
                return
            if request_path == "/v1/household":
                self._send(HTTPStatus.OK, self.server.orchestrator.household_status(query.get("profile", ["alex"])[0]))
                return
            match = REQUEST_PATH.match(request_path)
            if match:
                record = self.server.orchestrator.request_record(match.group(1))
                if record is None:
                    self._send(HTTPStatus.NOT_FOUND, {"error": "request not found"})
                else:
                    self._send(HTTPStatus.OK, record)
                return
            self._send(HTTPStatus.NOT_FOUND, {"error": "route not found"})
        except Exception as exc:
            self._error(exc)

    def do_POST(self) -> None:
        try:
            request_path = urlsplit(self.path).path
            if request_path in {"/v1/maintenance", "/v1/maintenance/complete"}:
                if not self._household_control_permitted():
                    return
                body = self._json_body()
                store = self.server.orchestrator.maintenance
                result = store.add(body) if request_path == "/v1/maintenance" else store.complete(body.get("id"))
                self._send(HTTPStatus.OK, result)
                return
            if self.path == "/v1/travel/review":
                if not self._household_control_permitted():
                    return
                self._send(HTTPStatus.OK, self.server.orchestrator.confirm_travel_review(self._json_body()))
                return
            if self.path == "/v1/home/hvac":
                if not self._household_control_permitted():
                    return
                body = self._json_body()
                result = self.server.orchestrator.set_home_temperature(
                    body.get("temperature"), self.client_address[0]
                )
                self._send(HTTPStatus.OK, result)
                return
            if self.path == "/v1/home/controls":
                if not self._household_control_permitted():
                    return
                body = self._json_body()
                result = self.server.orchestrator.set_home_control(body.get("entity_id"), body.get("enabled"), self.client_address[0])
                self._send(HTTPStatus.OK, result)
                return
            if self.path == "/v1/household/messages":
                if not self._household_control_permitted():
                    return
                body = self._json_body()
                result = self.server.orchestrator.send_household_message(body.get("sender"), body.get("recipient"), body.get("body"))
                self._send(HTTPStatus.OK, result)
                return
            if self.path == "/v1/household/profile/switch":
                if not self._household_control_permitted():
                    return
                body = self._json_body()
                result = self.server.orchestrator.switch_household_profile(body.get("profile"), body.get("pin"))
                self._send(HTTPStatus.OK, result)
                return
            household_read = HOUSEHOLD_READ_PATH.match(self.path)
            if household_read:
                if not self._household_control_permitted():
                    return
                body = self._json_body()
                result = self.server.orchestrator.mark_household_message_read(household_read.group(1), body.get("profile"))
                self._send(HTTPStatus.OK, result)
                return
            if self.path == "/v1/security/vacation-ids":
                if not self._household_control_permitted():
                    return
                body = self._json_body()
                result = self.server.orchestrator.set_vacation_ids(
                    body.get("armed"), body.get("confirmation"), self.client_address[0]
                )
                self._send(HTTPStatus.OK, result)
                return
            if self.path == "/v1/chat":
                if not self._household_control_permitted():
                    return
                body = self._json_body()
                self._send(HTTPStatus.OK, self.server.orchestrator.chat(body))
                return
            if not self._client_permitted(write=True):
                return
            body = self._json_body()
            if self.path == "/v1/orchestrate":
                self._send(HTTPStatus.OK, self.server.orchestrator.orchestrate(body))
                return
            match = ACTION_PATH.match(self.path)
            if match:
                action_id, operation = match.groups()
                if operation == "preview":
                    result = self.server.orchestrator.preview_action(action_id)
                else:
                    result = self.server.orchestrator.execute_action(action_id, body.get("confirmation_id"))
                self._send(HTTPStatus.OK, result)
                return
            self._send(HTTPStatus.NOT_FOUND, {"error": "route not found"})
        except Exception as exc:
            self._error(exc)

    def do_DELETE(self) -> None:
        try:
            if not self._household_control_permitted():
                return
            parsed = urlsplit(self.path)
            match = HOUSEHOLD_MESSAGE_PATH.match(parsed.path)
            if not match:
                self._send(HTTPStatus.NOT_FOUND, {"error": "route not found"})
                return
            profile = parse_qs(parsed.query).get("profile", ["alex"])[0]
            result = self.server.orchestrator.delete_household_message(match.group(1), profile)
            self._send(HTTPStatus.OK, result)
        except Exception as exc:
            self._error(exc)

    def _error(self, exc: Exception) -> None:
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            self.close_connection = True
        elif isinstance(exc, KeyError):
            self._send(HTTPStatus.NOT_FOUND, {"error": "entity not found"})
        elif isinstance(exc, (ValueError, json.JSONDecodeError)):
            self._send(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        elif isinstance(exc, RuntimeError):
            self._send(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(exc)})
        else:
            self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal server error"})


def serve(
    orchestrator: AtlasOrchestrator,
    host: str,
    port: int,
    trusted_networks: tuple[str, ...] = ("127.0.0.0/8", "::1/128"),
    allow_remote_writes: bool = False,
) -> None:
    if host not in {"127.0.0.1", "localhost", "::1", "0.0.0.0", "::"}:
        raise ValueError("the HTTP server may bind only to loopback or a wildcard interface")
    if host in {"0.0.0.0", "::"} and set(trusted_networks) <= {"127.0.0.0/8", "::1/128"}:
        raise ValueError("wildcard binding requires an explicit trusted client network")
    server = AtlasHTTPServer(
        (host, port),
        orchestrator,
        trusted_networks=trusted_networks,
        allow_remote_writes=allow_remote_writes,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
