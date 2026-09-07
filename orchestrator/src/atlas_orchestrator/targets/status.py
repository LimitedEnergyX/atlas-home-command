from __future__ import annotations

import platform
import os
import sys
from pathlib import Path
from typing import Any

from ..schemas import utc_now


class StatusTarget:
    name = "status"
    writable = False

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)

    def status(self) -> dict[str, Any]:
        return {
            "observed_at": utc_now(),
            "python": sys.version.split()[0],
            "platform": platform.system(),
            "logical_cpu_count": os.cpu_count(),
            "data_dir_exists": self.data_dir.exists(),
        }
