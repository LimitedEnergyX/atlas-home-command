from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8080
    retry_budget: int = 1
    max_provider_workers: int = 8
    jarvis_status_config: Path | None = None
    galleyquest_config: Path | None = None
    powerwall_status_url: str = "http://127.0.0.1:17082/api/powerwall"
    home_assistant_url: str = "http://127.0.0.1:17081"
    trusted_networks: tuple[str, ...] = ("127.0.0.0/8", "::1/128")
    allow_remote_writes: bool = False

    @classmethod
    def from_env(cls, data_dir: str | Path | None = None) -> "Settings":
        root = Path(data_dir or os.environ.get("ATLAS_DATA_DIR", "data")).resolve()
        status_config = os.environ.get("ATLAS_STATUS_CONFIG") or os.environ.get(
            "ATLAS_JARVIS_STATUS_CONFIG"
        )
        preferred_status_config = (root.parent / "config" / "atlas-status.json").resolve()
        legacy_status_config = (root.parent / "config" / "jarvis-status.json").resolve()
        galleyquest_config = os.environ.get(
            "ATLAS_GALLEYQUEST_CONFIG", "config/galleyquest.js"
        )
        trusted_networks = tuple(
            value.strip()
            for value in os.environ.get(
                "ATLAS_TRUSTED_NETWORKS", "127.0.0.0/8,::1/128"
            ).split(",")
            if value.strip()
        )
        return cls(
            data_dir=root,
            host=os.environ.get("ATLAS_HOST", "127.0.0.1"),
            port=int(os.environ.get("ATLAS_PORT", "8080")),
            retry_budget=max(0, int(os.environ.get("ATLAS_RETRY_BUDGET", "1"))),
            max_provider_workers=max(1, min(64, int(os.environ.get("ATLAS_MAX_PROVIDER_WORKERS", "8")))),
            jarvis_status_config=(
                Path(status_config).resolve()
                if status_config
                else (
                    preferred_status_config
                    if preferred_status_config.exists()
                    else legacy_status_config
                )
            ),
            galleyquest_config=Path(galleyquest_config).resolve(),
            powerwall_status_url=os.environ.get(
                "ATLAS_POWERWALL_STATUS_URL", "http://127.0.0.1:17082/api/powerwall"
            ),
            home_assistant_url=os.environ.get(
                "ATLAS_HOME_ASSISTANT_URL", "http://127.0.0.1:17081"
            ),
            trusted_networks=trusted_networks,
            allow_remote_writes=os.environ.get("ATLAS_ALLOW_REMOTE_WRITES", "0") == "1",
        )


def configured_secrets() -> list[str]:
    return [
        os.environ.get("OPENAI_API_KEY", ""),
        os.environ.get("ANTHROPIC_API_KEY", ""),
        os.environ.get("XAI_API_KEY", ""),
        os.environ.get("ATLAS_HOME_ASSISTANT_TOKEN", ""),
    ]
