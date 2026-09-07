"""Always test this checkout, never a different editable Atlas installation."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
# Integration tests use injected readers, local mock servers, and temporary stores.
for name in ("ATLAS_HOME_ASSISTANT_TOKEN", "ATLAS_IDS_MONITOR_ENABLED", "ATLAS_GALLEYQUEST_ANON_KEY"):
    os.environ.pop(name, None)
