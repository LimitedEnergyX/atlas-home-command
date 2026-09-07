from __future__ import annotations

import argparse
import getpass
import json
from pathlib import Path
from typing import Any

from .api import serve
from .config import Settings
from .core import AtlasOrchestrator


def _print(value: Any) -> None:
    print(json.dumps(value, indent=2, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="atlas-orchestrator")
    root.add_argument("--data-dir", type=Path, default=None)
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("health")
    commands.add_parser("status")
    commands.add_parser("atlas-status")
    commands.add_parser("jarvis-status")
    pin = commands.add_parser("set-profile-pin")
    pin.add_argument("profile", choices=("alex",))
    serve_parser = commands.add_parser("serve")
    serve_parser.add_argument("--host", default=None)
    serve_parser.add_argument("--port", type=int, default=None)
    orchestrate = commands.add_parser("orchestrate")
    source = orchestrate.add_mutually_exclusive_group(required=True)
    source.add_argument("--intent")
    source.add_argument("--request-file", type=Path)
    orchestrate.add_argument(
        "--policy", choices=("single", "fallback", "compare", "local-only"), default="local-only"
    )
    orchestrate.add_argument("--provider", action="append", dest="providers")
    orchestrate.add_argument("--deadline-ms", type=int, default=90_000)
    request = commands.add_parser("request")
    request.add_argument("request_id")
    preview = commands.add_parser("preview")
    preview.add_argument("action_id")
    execute = commands.add_parser("execute")
    execute.add_argument("action_id")
    execute.add_argument("--confirmation-id")
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    settings = Settings.from_env(args.data_dir)
    orchestrator = AtlasOrchestrator(settings)
    if args.command == "health":
        _print(orchestrator.health())
    elif args.command == "status":
        _print(orchestrator.local_status())
    elif args.command == "atlas-status":
        _print(orchestrator.atlas_status())
    elif args.command == "jarvis-status":
        _print(orchestrator.jarvis_status())
    elif args.command == "set-profile-pin":
        first = getpass.getpass("Enter the 6-digit Alex profile PIN: ")
        second = getpass.getpass("Confirm the 6-digit Alex profile PIN: ")
        if first != second:
            raise SystemExit("PIN entries did not match")
        _print(orchestrator.set_household_profile_pin(args.profile, first))
    elif args.command == "serve":
        serve(
            orchestrator,
            args.host or settings.host,
            args.port or settings.port,
            trusted_networks=settings.trusted_networks,
            allow_remote_writes=settings.allow_remote_writes,
        )
    elif args.command == "orchestrate":
        if args.request_file:
            request = json.loads(args.request_file.read_text(encoding="utf-8"))
            if not isinstance(request, dict):
                raise SystemExit("request file must contain one JSON object")
        else:
            request = {
                "intent": args.intent,
                "provider_policy": args.policy,
                "deadline_ms": args.deadline_ms,
            }
            if args.providers:
                request["providers"] = args.providers
        _print(orchestrator.orchestrate(request))
    elif args.command == "request":
        result = orchestrator.request_record(args.request_id)
        if result is None:
            raise SystemExit(f"request not found: {args.request_id}")
        _print(result)
    elif args.command == "preview":
        _print(orchestrator.preview_action(args.action_id))
    elif args.command == "execute":
        _print(orchestrator.execute_action(args.action_id, args.confirmation_id))
    return 0
