"""Copy exactly what the running app reads into a staging folder (shared by every deploy target)."""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent / "hf-space"
SKIP_DIRS = {"__pycache__", "mlruns", ".venv", "node_modules", "raw"}

README = """---
title: BeeGuard Lab
emoji: 🐝
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: true
license: cc-by-nc-4.0
short_description: Retrospective honey-bee toxicity discovery benchmark
---

# BeeGuard Lab

A retrospective benchmark that trains on compounds first reported by a
cutoff year, ranks later compounds, and reveals existing ApisTox labels.
Compound first-report year is a proxy, not the date a toxicity label became
available. A dataset non-toxic label does not establish field safety.

Recorded agent conversations are replayed separately from live model
computations; replay text alone is not experimental evidence.

Code: https://github.com/unikaive730/hn7 · API docs: `/docs`

Data: ApisTox (Adamczyk et al., CC-BY-NC-4.0), ChEMBL (CC BY-SA 3.0),
PubChem, OpenAlex, Europe PMC, arXiv. Built for Hack-Nation 7, Challenge 3.
"""


def copy_tree(src: Path, dst: Path) -> None:
    for path in src.rglob("*"):
        if any(part in SKIP_DIRS for part in path.relative_to(src).parts):
            continue
        if path.is_file():
            target = dst / path.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def stage(out: Path) -> None:
    for name in ("Dockerfile", "space_app.py", "requirements.txt"):
        shutil.copy2(HERE / name, out / name)
    (out / "README.md").write_text(README, encoding="utf-8")
    shutil.copy2(ROOT / "LICENSE", out / "LICENSE")
    shutil.copy2(ROOT / "deploy" / "verify_release.py", out / "verify_release.py")
    (out / "lab").mkdir()
    (out / "lab" / "__init__.py").write_text("", encoding="utf-8")
    copy_tree(ROOT / "lab" / "beeguard", out / "lab" / "beeguard")
    copy_tree(ROOT / "lab" / "data", out / "lab" / "data")
    copy_tree(ROOT / "lab" / "scripts", out / "lab" / "scripts")
    shutil.copy2(ROOT / "lab" / "requirements.txt", out / "lab" / "requirements.txt")
    record = ROOT / "lab" / "results" / "research_record.jsonl"
    if record.exists():
        (out / "lab" / "results").mkdir()
        shutil.copy2(record, out / "lab" / "results" / record.name)
    copy_tree(ROOT / "agents", out / "agents")
    # The provenance ledger inspects these sources at runtime. The built
    # bundle alone cannot establish which packages the UI actually uses.
    copy_tree(ROOT / "apps" / "web" / "src", out / "apps" / "web" / "src")
    shutil.copy2(ROOT / "apps" / "web" / "package.json", out / "apps" / "web" / "package.json")
    copy_tree(ROOT / "scripts", out / "scripts")
    dist = ROOT / "apps" / "web" / "dist"
    if not (dist / "index.html").exists():
        raise SystemExit("apps/web/dist is missing: run npm run build in apps/web first")
    copy_tree(dist, out / "apps" / "web" / "dist")
