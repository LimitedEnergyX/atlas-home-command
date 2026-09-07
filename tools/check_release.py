"""A bounded source hygiene check, not a substitute for security review."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache", "dist", "build", "data", "runtime"}
TEXT = {".py", ".cjs", ".js", ".css", ".html", ".json", ".toml", ".lock", ".md", ".yml", ".svg"}
APPROVED_RASTERS = {"orchestrator/src/atlas_orchestrator/web/heroes/atlas-home-desktop.png"} | {
    f"orchestrator/src/atlas_orchestrator/web/greek/{name}.png"
    for name in ("vesta", "sol", "aeolus", "titan", "demeter", "oracle", "vulcan", "athena", "olympus")
}
PATTERNS = {
    "private key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "provider credential": r"\b(?:sk-proj-|sk-ant-|ghp_|github_pat_)[A-Za-z0-9_-]{30,}",
    "JWT-shaped credential": r"\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}",
    "private LAN address": r"\b192\.168\.\d{1,3}\.\d{1,3}\b",
}


def check():
    issues=[]
    count=0
    for path in ROOT.rglob("*"):
        relative=path.relative_to(ROOT)
        if not path.is_file() or any(part in SKIP or part.endswith(".egg-info") for part in relative.parts):
            continue
        count+=1
        if path.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".pfx", ".pdf", ".jpg", ".jpeg"} or path.name.startswith(".env") and path.name != ".env.example":
            issues.append(f"{relative}: excluded artifact type")
        if path.suffix.lower()==".png" and relative.as_posix() not in APPROVED_RASTERS:
            issues.append(f"{relative}: raster is outside the asset allowlist")
        if path.suffix not in TEXT:
            continue
        text=path.read_text(encoding="utf-8")
        for label,pattern in PATTERNS.items():
            if re.search(pattern,text): issues.append(f"{relative}: {label}")
    if issues:
        print("\n".join(issues));return 1
    print(f"Source hygiene check passed for {count} files. Manual review remains required.")
    return 0


if __name__=="__main__":
    sys.exit(check())
