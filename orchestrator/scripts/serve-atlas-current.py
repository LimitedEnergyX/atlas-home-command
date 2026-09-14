from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path


ORCHESTRATOR_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ORCHESTRATOR_ROOT / "src"
EXPECTED_PACKAGE_ROOT = (SOURCE_ROOT / "atlas_orchestrator").resolve()

# Put the checked-out source ahead of any older installed Atlas package.
sys.path.insert(0, str(SOURCE_ROOT))

import atlas_orchestrator  # noqa: E402
import atlas_orchestrator.api as atlas_api  # noqa: E402
import atlas_orchestrator.core as atlas_core  # noqa: E402
import atlas_orchestrator.targets.household as household_target  # noqa: E402
from atlas_orchestrator.cli import main  # noqa: E402


def _module_path(module: object) -> Path:
    value = getattr(module, "__file__", None)
    if not value:
        raise RuntimeError(f"Atlas module has no filesystem provenance: {module!r}")
    resolved = Path(value).resolve()
    if not resolved.is_relative_to(EXPECTED_PACKAGE_ROOT):
        raise RuntimeError(f"Atlas resolved outside the current source tree: {resolved}")
    return resolved


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


package_path = _module_path(atlas_orchestrator)
api_path = _module_path(atlas_api)
core_path = _module_path(atlas_core)
household_path = _module_path(household_target)
profile_pin_feature = "alex_pin_configured" in household_path.read_text(encoding="utf-8")
if not profile_pin_feature:
    raise RuntimeError("Current Atlas household target does not expose profile-PIN state.")

provenance = {
    "started_at": datetime.now().astimezone().isoformat(),
    "pid": os.getpid(),
    "python": sys.executable,
    "source_root": str(SOURCE_ROOT),
    "module": str(package_path),
    "api": str(api_path),
    "core": str(core_path),
    "household": str(household_path),
    "api_sha256": _sha256(api_path),
    "core_sha256": _sha256(core_path),
    "household_sha256": _sha256(household_path),
    "feature_profile_pin": profile_pin_feature,
}
def _requested_data_dir(argv: list[str]) -> Path:
    try:
        value_index = argv.index("--data-dir") + 1
        return Path(argv[value_index]).expanduser().resolve()
    except (ValueError, IndexError):
        return (ORCHESTRATOR_ROOT / "data").resolve()


provenance_path = _requested_data_dir(sys.argv[1:]) / "runtime-provenance.json"
provenance_path.parent.mkdir(parents=True, exist_ok=True)
temporary_path = provenance_path.with_suffix(".json.tmp")
temporary_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
temporary_path.replace(provenance_path)

raise SystemExit(main())
