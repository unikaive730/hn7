"""Entry point for the Space: the lab API plus the built web app on one port."""
import os
from pathlib import Path

from fastapi.staticfiles import StaticFiles

from lab.beeguard.api import app

DIST = Path(os.environ.get("WEB_DIST", "/app/apps/web/dist"))
already = any(getattr(route, "path", None) in ("", "/") and getattr(route, "name", "") == "web" for route in app.routes)
if DIST.is_dir() and not already:
    app.mount("/", StaticFiles(directory=DIST, html=True), name="web")
