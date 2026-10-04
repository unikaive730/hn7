"""Facts the site frame shows: which data sources the code calls, and the
headline numbers for the share card.

The source list is not typed by hand. It scans the backend for call sites, so
a source appears on the page only once some module really calls it, and the
page can say where.

    python -m lab.beeguard.brand   # writes lab/data/derived/brand_numbers.json
"""
from __future__ import annotations

import ast
import io
import json
import re
import time
import tokenize
from functools import lru_cache
from pathlib import Path

from .engine import get_lab

ROOT = Path(__file__).resolve().parents[2]
DERIVED = ROOT / "lab" / "data" / "derived"

# Each entry: how to recognise a real call in code, and how to credit it.
# Markers are call patterns, not definitions: `def pubchem_compound(` does not
# count, `sources.pubchem_compound(cid)` does.
REGISTRY: list[dict] = [
    {
        "id": "apistox",
        "name": "ApisTox",
        "role": "bee toxicity labels and first-report years, bundled with the app",
        "kind": "bundled",
        "license": "CC BY-NC 4.0",
        "license_url": "https://creativecommons.org/licenses/by-nc/4.0/",
        "url": "https://github.com/j-adamczyk/ApisTox_dataset",
        "citation": (
            "Adamczyk J., Poziemski J., Siedlecki P. ApisTox: a new benchmark "
            "dataset for the classification of small molecules toxicity on "
            "honey bees. Scientific Data 12, 5 (2025)."
        ),
        "doi": "https://doi.org/10.1038/s41597-024-04232-w",
        "markers": [r"dataset_final\.csv"],
    },
    {
        "id": "pubchem",
        "name": "PubChem",
        "role": "compound properties, fetched per molecule",
        "kind": "live",
        "license": "Public domain (NCBI data policy)",
        "license_url": "https://www.ncbi.nlm.nih.gov/home/about/policies/",
        "url": "https://pubchem.ncbi.nlm.nih.gov/",
        "citation": None,
        "markers": [r"(?<!def )\bpubchem_compound\(", r"^\s*import pubchempy|^\s*from pubchempy"],
    },
    {
        "id": "chembl",
        "name": "ChEMBL",
        "role": "honey bee LD50 records for an outside test, and crop-pest potency records",
        # Pulled once by lab/scripts/fetch_chembl.py into lab/data/chembl_*.csv;
        # the app reads those files and does not call ChEMBL per request.
        "kind": "fetched",
        "license": "CC BY-SA 3.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/3.0/",
        "url": "https://www.ebi.ac.uk/chembl/",
        # Checked against Crossref on 2026-10-04.
        "citation": (
            "Zdrazil B. et al. The ChEMBL Database in 2023: a drug discovery "
            "platform spanning multiple bioactivity data types and time periods. "
            "Nucleic Acids Research 52, D1180-D1192 (2024)."
        ),
        "doi": "https://doi.org/10.1093/nar/gkad1004",
        "markers": [r"chembl_webresource_client", r"ebi\.ac\.uk/chembl/api"],
    },
    {
        "id": "openalex",
        "name": "OpenAlex",
        "role": "literature search",
        "kind": "live",
        "license": "CC0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "url": "https://openalex.org/",
        "citation": None,
        "markers": [r"(?<!def )\bopenalex_works\(", r"^\s*import pyalex|^\s*from pyalex"],
    },
    {
        "id": "europepmc",
        "name": "Europe PMC",
        "role": "literature search",
        "kind": "live",
        "license": "Metadata free to reuse; article licenses vary",
        "license_url": "https://europepmc.org/Copyright",
        "url": "https://europepmc.org/",
        "citation": None,
        "markers": [r"(?<!def )\beuropepmc_search\("],
    },
    {
        "id": "arxiv",
        "name": "arXiv",
        "role": "preprint search",
        "kind": "live",
        "license": "Metadata CC0; papers under author licenses",
        "license_url": "https://info.arxiv.org/help/api/tou.html",
        "url": "https://arxiv.org/",
        "citation": None,
        "markers": [r"(?<!def )\barxiv_search\("],
    },
]

# Files that hold source URLs as data (this module, and the ledger that probes
# each source's status endpoint). They are not the lab using a source.
_SELF = {"brand.py", "routes_brand.py", "ledger.py", "routes_ledger.py"}
_MAIN = re.compile(r"^if __name__ == .__main__.:", re.MULTILINE)


def _code_files() -> list[Path]:
    files = sorted((ROOT / "lab" / "beeguard").glob("*.py"))
    files += sorted((ROOT / "lab" / "scripts").glob("*.py"))
    agents = ROOT / "agents"
    if agents.exists():
        files += sorted(agents.rglob("*.py"))
    return [f for f in files if f.name not in _SELF and ".venv" not in f.parts]


def _code_only(text: str) -> str:
    """Blank comments and docstrings, keeping line numbers.

    A source named in prose ("Source: ChEMBL web services, https://...") is
    not a call, so it must not show up as one on the page.
    """
    lines = text.split("\n")
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT:
                row, col = tok.start
                lines[row - 1] = lines[row - 1][:col]
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return "\n".join(lines)
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        first = node.body[0] if node.body else None
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            for index in range(first.lineno - 1, first.end_lineno):
                lines[index] = ""
    return "\n".join(lines)


def _strip_self_test(text: str) -> str:
    """Code under `if __name__ == "__main__":` is a self-test, not the app."""
    match = _MAIN.search(text)
    return text[: match.start()] if match else text


def _site_key(site: str) -> tuple[str, int]:
    path, _, line = site.rpartition(":")
    return path, int(line)


def _csv_rows(path: Path) -> int | None:
    """Data rows in the bundled CSV, counted rather than quoted."""
    import csv

    try:
        with path.open(encoding="utf-8", newline="") as handle:
            return sum(1 for _ in csv.DictReader(handle))
    except OSError:
        return None


@lru_cache(maxsize=1)
def sources() -> dict:
    """Which registered sources have a call site in the code, and where."""
    started = time.time()
    files = _code_files()
    texts = {}
    for path in files:
        try:
            texts[path] = _strip_self_test(_code_only(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError):
            continue

    rows = []
    for entry in REGISTRY:
        patterns = [re.compile(m, re.MULTILINE) for m in entry["markers"]]
        found_in = []
        for path, text in texts.items():
            for pattern in patterns:
                for match in pattern.finditer(text):
                    line = text.count("\n", 0, match.start()) + 1
                    found_in.append(f"{path.relative_to(ROOT).as_posix()}:{line}")
        public = {k: v for k, v in entry.items() if k != "markers"}
        row = {**public, "called": bool(found_in), "found_in": sorted(set(found_in), key=_site_key)}
        if entry["id"] == "apistox":
            row["molecules"] = _csv_rows(ROOT / "lab" / "data" / "dataset_final.csv")
        rows.append(row)

    return {
        "sources": rows,
        "called": [r["id"] for r in rows if r["called"]],
        "scanned_files": len(texts),
        "scanned_seconds": round(time.time() - started, 3),
        "method": "regex scan for call sites in lab/beeguard, lab/scripts and agents; comments, docstrings and self-test blocks excluded",
    }


def headline(cutoff_year: int = 2000, budget: int = 30) -> dict:
    """The numbers the hero and share card show, computed from the lab."""
    lab = get_lab(cutoff_year)
    facts = lab.facts()
    run = lab.run(strategy="model", budget=budget)
    full = lab.run(strategy="model", budget=facts["pool_molecules"])
    return {
        "facts": facts,
        "run": {k: v for k, v in run.items() if k != "assays"},
        "order": [
            {"position": a["position"], "is_target": a["is_target"], "scaffold_seen": a["scaffold_seen"]}
            for a in full["assays"]
        ],
    }


def write_numbers() -> Path:
    DERIVED.mkdir(parents=True, exist_ok=True)
    out = DERIVED / "brand_numbers.json"
    payload = {
        "command": "PYTHONUTF8=1 PYTHONPATH=. lab/.venv/Scripts/python.exe -m lab.beeguard.brand",
        "computed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        **headline(),
        "sources_called": sources()["called"],
    }
    out.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    return out


if __name__ == "__main__":
    path = write_numbers()
    data = json.loads(path.read_text(encoding="utf-8"))
    print(path)
    print(json.dumps({"facts": data["facts"], "run": data["run"], "sources_called": data["sources_called"]}, indent=1))
    for row in sources()["sources"]:
        print(f"{row['id']:10s} called={row['called']!s:5s} {', '.join(row['found_in'][:3])}")
