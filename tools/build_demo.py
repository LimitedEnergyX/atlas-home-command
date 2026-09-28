"""Export only approved browser assets, with no data directory or backend."""
from pathlib import Path
import re
import shutil
import hashlib

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
            content = source.read_text(encoding="utf-8").replace("/assets/", prefix)
            if relative.as_posix() == 'atlas.js':
                content = content.replace('location.replace("/argo/")', 'location.assign("argo/")')
            target.write_text(content, encoding="utf-8")
        else:
            shutil.copyfile(source, target)
    html = (WEB / "index.html").read_text(encoding="utf-8")
    html = html.replace("/assets/", "assets/").replace("/favicon.ico", "assets/favicon.svg")
    html = re.sub(r'<article class="weather-radar-card">[\s\S]*?</article>', '''<article class="weather-radar-card">
      <div><h3>Simulated Dallas Radar</h3><span>Demo Only · Not Live Weather</span></div>
      <div class="weather-radar-link demo-radar">
        <img src="assets/dallas-radar-demo.png" alt="Simulated Dallas-Fort Worth radar with an intense fictional storm line. Not live weather." loading="lazy">
        <span>Fictional Storm Scenario · Not For Weather Decisions</span>
      </div>
    </article>''', html)
    html = re.sub(r'<a\b[^>]*id="open-radar"[^>]*>[\s\S]*?</a>', '<span class="demo-section-note">Simulated Weather Preview</span>', html)
    policy = "default-src 'self'; connect-src 'none'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    html = html.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">\n<script src="energy-samples.js"></script>\n<script src="household-samples.js"></script>\n<script src="release-samples.js"></script>\n<script src="demo.js"></script>')
    html = html.replace('</head>', '<link rel="stylesheet" href="demo.css">\n</head>')
    (OUT / "index.html").write_text(html, encoding="utf-8")
    for name in ("demo.js", "demo.css", "energy-samples.js", "household-samples.js", "release-samples.js"):
        shutil.copyfile(ROOT / "demo" / name, OUT / name)
    argo = OUT / 'argo'
    argo.mkdir(exist_ok=True)
    vehicle_html = (WEB / 'argo/vehicle.html').read_text(encoding='utf-8')
    vehicle_html = vehicle_html.replace('/favicon.ico', '../assets/favicon.svg').replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">\n' + ''.join('<script src="../'+name+'"></script>\n' for name in ('energy-samples.js','household-samples.js','release-samples.js','demo.js')) + '<link rel="stylesheet" href="../demo.css">')
    for name in ('index.html','vehicle.html'):
        (argo/name).write_text(vehicle_html, encoding='utf-8')
    for source in (WEB/'argo/assets').rglob('*'):
        if source.is_file() and source.suffix in {'.js','.css'}:
            dest = argo/'assets'/source.relative_to(WEB/'argo/assets')
            dest.parent.mkdir(parents=True,exist_ok=True)
            content = source.read_text(encoding='utf-8').replace("'/argo/", "'../argo/").replace('"/argo/', '"../argo/').replace("'/#", "'../#").replace('"/#', '"../#')
            content = content.replace('/assets/', '../../../assets/' if source.suffix == '.css' else '../assets/')
            dest.write_text(content, encoding='utf-8')
    # Fingerprint changed scripts/styles so an already-open preview refreshes reliably.
    for page in (OUT/'index.html', argo/'index.html', argo/'vehicle.html'):
        def version(match):
            attribute, relative = match.groups()
            asset = (page.parent/relative).resolve()
            if not asset.is_file() or asset.name == 'demo.js':
                return match.group(0)
            digest = hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
            return f'{attribute}="{relative}?v={digest}"'
        content = re.sub(r'(src|href)="([^"?]+\.(?:js|css))"', version, page.read_text(encoding='utf-8'))
        page.write_text(content, encoding='utf-8')
    (OUT / ".nojekyll").touch()
    print("Built disconnected demo in dist/")


if __name__ == "__main__":
    build()
