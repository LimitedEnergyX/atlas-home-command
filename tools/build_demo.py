"""Export only approved browser assets, with no data directory or backend."""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "orchestrator/src/atlas_orchestrator/web"
OUT = ROOT / "dist"


def build():
    OUT.mkdir(exist_ok=True)
    for source in WEB.rglob("*"):
        if not source.is_file() or source.suffix not in {".js", ".css", ".svg", ".png"}:
            continue
        relative = source.relative_to(WEB)
        target = OUT / "assets" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix in {".js", ".css"}:
            prefix = "./" if source.suffix == ".css" else "assets/"
            target.write_text(source.read_text(encoding="utf-8").replace("/assets/", prefix), encoding="utf-8")
        else:
            shutil.copyfile(source, target)
    html = (WEB / "index.html").read_text(encoding="utf-8")
    html = html.replace("/assets/", "assets/").replace("/favicon.ico", "assets/favicon.svg")
    html = re.sub(r'<img\b[^>]*id="weather-radar-image"[^>]*>', '<p>Radar disconnected in public demo.</p>', html)
    policy = "default-src 'self'; connect-src 'none'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    html = html.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">\n<script src="energy-samples.js"></script>\n<script src="household-samples.js"></script>\n<script src="demo.js"></script>')
    html = html.replace('</head>', '<link rel="stylesheet" href="demo.css">\n</head>')
    (OUT / "index.html").write_text(html, encoding="utf-8")
    for name in ("demo.js", "demo.css", "energy-samples.js", "household-samples.js"):
        shutil.copyfile(ROOT / "demo" / name, OUT / name)
    (OUT / ".nojekyll").touch()
    print("Built disconnected demo in dist/")


if __name__ == "__main__":
    build()
