"""An inventory of what the lab actually uses, computed when it is asked for.

Nothing in here is a list someone typed. Dataset rows are counted from the
files, checksums are recomputed and compared with the manifest the download
script wrote, packages come from the import statements in lab/beeguard, MCP
tools from the decorators in mcp_server.py, agents from their config files,
and each live source is probed with one small request. If a source is down,
the ledger says so.

The method and data cards read their settings out of the source with ``ast``
and report the file and line each one came from, so a reader can check them.
"""
from __future__ import annotations

import ast
import hashlib
import importlib.metadata as metadata
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pandas as pd

from .brand import REGISTRY as SOURCE_REGISTRY

BEEGUARD = Path(__file__).resolve().parent
LAB = BEEGUARD.parent
ROOT = LAB.parent
DATA = LAB / "data"
DERIVED = DATA / "derived"
WEB = ROOT / "apps" / "web"
AGENTS = ROOT / "agents" / "beeguard"

# Files that are this module and its routes. They contain the probe URLs, so
# they are left out when deciding which lab code calls which source.
_SELF = {"ledger.py", "routes_ledger.py"}


def _rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _lab_modules() -> list[Path]:
    return sorted(p for p in BEEGUARD.glob("*.py") if p.name not in _SELF)


# ------------------------------------------------------------------ datasets


_LICENCE = re.compile(r"CC[- ]BY(?:-[A-Z]+)*[- ]\d\.\d")


def _licence_in(script: Path) -> dict[str, str | None]:
    text = script.read_text(encoding="utf-8")
    match = _LICENCE.search(text)
    if not match:
        return {"license": None, "license_from": None}
    line = text[: match.start()].count("\n") + 1
    return {"license": match.group(0), "license_from": f"{_rel(script)}:{line}"}


def _writer_script(filename: str) -> Path | None:
    """The download script that names this file, if there is one."""
    # Download scripts first: baseline.py also names dataset_final.csv, but only reads it.
    scripts = sorted((LAB / "scripts").glob("*.py"), key=lambda p: (not p.name.startswith("fetch"), p.name))
    for script in scripts:
        if filename in script.read_text(encoding="utf-8"):
            return script
    return None


def _license_from_fetch_script() -> dict[str, str | None]:
    """Read the ApisTox licence from its download script instead of retyping it."""
    script = LAB / "scripts" / "fetch_data.py"
    if not script.exists():
        return {"license": None, "license_from": None}
    return _licence_in(script)


def _licence_for(filename: str, entry: dict) -> dict[str, str | None]:
    if entry.get("licence") or entry.get("license"):
        return {
            "license": entry.get("licence") or entry.get("license"),
            "license_from": entry.get("manifest"),
        }
    script = _writer_script(filename)
    return _licence_in(script) if script else {"license": None, "license_from": None}


def _manifests() -> dict[str, dict]:
    merged: dict[str, dict] = {}
    for path in sorted(DATA.glob("*manifest*.json")):
        try:
            content = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        shared = {}
        entries = content
        if isinstance(content.get("files"), dict):
            entries = content["files"]
            shared = {k: content[k] for k in ("licence", "license", "source", "endpoint") if k in content}
        for name, entry in entries.items():
            if isinstance(entry, dict) and "sha256" in entry:
                merged[name] = {**shared, **entry, "manifest": _rel(path)}
    return merged


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def datasets() -> dict[str, Any]:
    manifest = _manifests()
    files = []
    for path in sorted(DATA.glob("*.csv")):
        frame = pd.read_csv(path)
        sha = _sha256(path)
        entry = manifest.get(path.name, {})
        licence = _licence_for(path.name, entry)
        writer = _writer_script(path.name)
        files.append(
            {
                "file": path.name,
                "path": _rel(path),
                "rows": int(len(frame)),
                "columns": int(frame.shape[1]),
                "column_names": [str(c) for c in frame.columns],
                "bytes": path.stat().st_size,
                "sha256": sha,
                "manifest": entry.get("manifest"),
                "manifest_sha256": entry.get("sha256"),
                "matches_manifest": (entry.get("sha256") == sha) if entry else None,
                "source_url": entry.get("url") or entry.get("endpoint"),
                "written_by": _rel(writer) if writer else None,
                "license": licence["license"],
                "license_from": licence["license_from"],
            }
        )
    apistox = _license_from_fetch_script()
    return {
        "files": files,
        "manifests": sorted({e["manifest"] for e in manifest.values()}),
        "license_from": apistox["license_from"],
    }


def derived() -> dict[str, Any]:
    """Precomputed files the app ships with. Folders are summarised, not listed file by file."""
    if not DERIVED.exists():
        return {"entries": [], "files": 0, "bytes": 0}
    entries = []
    total_files = total_bytes = 0
    for path in sorted(DERIVED.iterdir()):
        if path.is_file():
            stat = path.stat()
            size, count, modified = stat.st_size, 1, stat.st_mtime
        elif path.is_dir():
            inner = [p for p in path.rglob("*") if p.is_file()]
            if not inner:
                continue
            size = sum(p.stat().st_size for p in inner)
            count = len(inner)
            modified = max(p.stat().st_mtime for p in inner)
        else:
            continue
        total_files += count
        total_bytes += size
        entries.append(
            {
                "name": path.name + ("/" if path.is_dir() else ""),
                "kind": "folder" if path.is_dir() else "file",
                "files": count,
                "bytes": size,
                "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(modified)),
            }
        )
    return {"path": _rel(DERIVED), "entries": entries, "files": total_files, "bytes": total_bytes}


# ------------------------------------------------------------- live sources

# One small request per service. `markers` decide whether lab code calls it:
# a host name in a URL or the import of that service's client library.
SOURCES: list[dict[str, Any]] = [
    {
        "name": "OpenAlex",
        "markers": ["api.openalex.org", "import pyalex", "from pyalex"],
        "probe": "https://api.openalex.org/works?search=honey%20bee&per-page=1&mailto=ceo@marketpilot.it",
        "read": lambda r: {"works_matching_honey_bee": r.json().get("meta", {}).get("count")},
    },
    {
        "name": "Europe PMC",
        "markers": ["ebi.ac.uk/europepmc"],
        "probe": "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=honey%20bee&format=json&pageSize=1",
        "read": lambda r: {"papers_matching_honey_bee": r.json().get("hitCount")},
    },
    {
        "name": "PubChem",
        "markers": ["pubchem.ncbi.nlm.nih.gov", "import pubchempy", "from pubchempy"],
        "probe": "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/971/property/MolecularFormula/JSON",
        "read": lambda r: {
            "cid_971_formula": r.json()["PropertyTable"]["Properties"][0].get("MolecularFormula")
        },
    },
    {
        "name": "ChEMBL",
        "markers": ["ebi.ac.uk/chembl", "chembl_webresource_client"],
        "probe": "https://www.ebi.ac.uk/chembl/api/data/status.json",
        "read": lambda r: {"chembl_release": r.json().get("chembl_db_version")},
    },
    {
        "name": "arXiv",
        "markers": ["export.arxiv.org", "import arxiv", "from arxiv"],
        "probe": "http://export.arxiv.org/api/query?search_query=all:honey%20bee&max_results=1",
        "read": lambda r: {
            "papers_matching_honey_bee": (
                int(m.group(1))
                if (m := re.search(r"totalResults[^>]*>(\d+)<", r.text))
                else None
            )
        },
    },
]

_PROBE_TTL = 600
_PROBE_DEADLINE = 6.0
_PROBE_MIN_GAP = 30
_probe_lock = threading.Lock()
_probe_cache: dict[str, Any] = {"at": 0.0, "rows": None}


def _is_inventory(text: str) -> bool:
    """Modules that list service markers (like this one) mention hosts without calling them."""
    return bool(re.search(r"""["']markers["']\s*:""", text))


def _usage(markers: list[str]) -> dict[str, list[str]]:
    """Which lab code calls the service at run time, and which scripts fetch from it offline."""
    texts = {p.name: p.read_text(encoding="utf-8") for p in _lab_modules()}
    texts = {n: t for n, t in texts.items() if not _is_inventory(t)}

    defined_in: list[str] = []
    functions: list[str] = []
    for name, text in texts.items():
        if not any(m in text for m in markers):
            continue
        defined_in.append(name)
        tree = ast.parse(text)
        # Module-level names that hold a marker, such as API = "https://...".
        holders = set()
        for node in tree.body:
            if isinstance(node, ast.Assign):
                segment = ast.get_source_segment(text, node) or ""
                if any(m in segment for m in markers):
                    holders.update(t.id for t in node.targets if isinstance(t, ast.Name))
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                segment = ast.get_source_segment(text, node) or ""
                if any(m in segment for m in markers) or any(
                    re.search(rf"\b{re.escape(h)}\b", segment) for h in holders
                ):
                    functions.append(node.name)

    called_by: list[str] = []
    for name, text in texts.items():
        if name in defined_in:
            continue
        if any(re.search(rf"\b{re.escape(fn)}\s*\(", text) for fn in functions):
            called_by.append(name)

    fetched_by: list[str] = []
    outputs: list[str] = []
    for script in sorted((LAB / "scripts").glob("*.py")):
        text = script.read_text(encoding="utf-8")
        if not any(m in text for m in markers):
            continue
        fetched_by.append(_rel(script))
        for found in re.findall(r"""["']([\w.-]+\.(?:csv|json))["']""", text):
            if (DATA / found).exists() and "manifest" not in found and found not in outputs:
                outputs.append(found)
    read_by = sorted({n for n, t in texts.items() for out in outputs if out in t})

    return {
        "defined_in": defined_in,
        "functions": functions,
        "called_by": called_by,
        "fetched_by": fetched_by,
        "outputs": outputs,
        "read_by": read_by,
    }


def _probe_one(source: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        with httpx.Client(
            timeout=httpx.Timeout(5.0, connect=3.0),
            headers={"User-Agent": "hn7-beeguard ledger (Hack-Nation 7 submission)"},
            follow_redirects=True,
        ) as client:
            response = client.get(source["probe"])
        latency = round((time.perf_counter() - started) * 1000)
        returned: dict[str, Any] = {}
        if response.status_code == 200:
            try:
                returned = source["read"](response)
            except Exception as exc:  # the service answered, but not as expected
                returned = {"parse_error": str(exc)[:120]}
        return {
            "status": response.status_code,
            "ok": response.status_code == 200,
            "latency_ms": latency,
            "returned": returned,
            "error": None,
        }
    except Exception as exc:
        return {
            "status": None,
            "ok": False,
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "returned": {},
            "error": f"{type(exc).__name__}: {str(exc)[:120]}",
        }


_probe_refreshing = threading.Event()


def _refresh_sources_in_background() -> None:
    """Re-probe without holding up the caller. One refresh at a time."""
    if _probe_refreshing.is_set():
        return
    _probe_refreshing.set()

    def work() -> None:
        try:
            live_sources(refresh=True)
        except Exception:  # a refresh failure leaves the old rows in place
            pass
        finally:
            _probe_refreshing.clear()

    threading.Thread(target=work, name="ledger-probe", daemon=True).start()


def live_sources(refresh: bool = False) -> dict[str, Any]:
    """Probe every service lab code calls.

    A cached round is served straight away and the refresh happens on a
    background thread, so no page load waits on an outside service. The
    payload carries ``age_seconds``, so the page can say how old it is.
    """
    age = time.time() - _probe_cache["at"]
    have = _probe_cache["rows"] is not None
    if have and not refresh:
        if age >= _PROBE_TTL:
            _refresh_sources_in_background()
        return {**_probe_cache["payload"], "age_seconds": round(age)}

    with _probe_lock:
        age = time.time() - _probe_cache["at"]
        fresh = _probe_cache["rows"] is not None and age < _PROBE_TTL
        if fresh and not (refresh and age > _PROBE_MIN_GAP):
            return {**_probe_cache["payload"], "age_seconds": round(age)}

        rows, not_called = [], []
        targets = []
        for source in SOURCES:
            usage = _usage(source["markers"])
            # A client that nothing calls is not a data source of this lab, so it
            # is not probed or counted. It is still named, with where it sits.
            if not usage["called_by"] and not usage["fetched_by"]:
                not_called.append({"name": source["name"], "defined_in": usage["defined_in"]})
                continue
            targets.append((source, usage))

        # One deadline for the whole round, so a slow service cannot hold the
        # first page load. A service that misses it is reported as a timeout.
        pool = ThreadPoolExecutor(max_workers=max(len(targets), 1))
        futures = [pool.submit(_probe_one, source) for source, _ in targets]
        wait(futures, timeout=_PROBE_DEADLINE)
        results = [
            f.result()
            if f.done()
            else {
                "status": None,
                "ok": False,
                "latency_ms": round(_PROBE_DEADLINE * 1000),
                "returned": {},
                "error": f"no answer within {_PROBE_DEADLINE:g} s",
            }
            for f in futures
        ]
        pool.shutdown(wait=False, cancel_futures=True)

        for (source, usage), result in zip(targets, results):
            host = re.sub(r"^https?://([^/]+).*$", r"\1", source["probe"])
            rows.append(
                {
                    "name": source["name"],
                    "host": host,
                    "probe": source["probe"],
                    "wired": bool(usage["called_by"]),
                    "mode": "live" if usage["called_by"] else "offline",
                    **usage,
                    **result,
                }
            )

        payload = {
            "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "ttl_seconds": _PROBE_TTL,
            "sources": rows,
            "not_called": not_called,
        }
        _probe_cache.update(at=time.time(), rows=rows, payload=payload)
        return {**payload, "age_seconds": 0}


# ----------------------------------------------------------------- packages


@lru_cache(maxsize=1)
def _distributions() -> dict[str, list[str]]:
    return metadata.packages_distributions()


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.add(node.module.split(".")[0])
    return found


def _requirement_names() -> list[str]:
    req = LAB / "requirements.txt"
    if not req.exists():
        return []
    names = []
    for line in req.read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if line:
            names.append(re.split(r"[<>=!~\[ ]", line)[0].lower())
    return names


def python_packages() -> dict[str, Any]:
    by_module: dict[str, set[str]] = {}
    for path in sorted(BEEGUARD.glob("*.py")):
        for module in _imports(path):
            by_module.setdefault(module, set()).add(path.name)

    stdlib = set(sys.stdlib_module_names) | {"__future__"}
    third_party, standard = [], []
    for module, files in sorted(by_module.items()):
        if module in ("lab",):
            continue
        if module in stdlib:
            standard.append(module)
            continue
        dists = _distributions().get(module, [])
        dist = dists[0] if dists else module
        try:
            version = metadata.version(dist)
        except metadata.PackageNotFoundError:
            version = None
        third_party.append(
            {"module": module, "distribution": dist, "version": version, "files": sorted(files)}
        )

    imported = {p["distribution"].lower() for p in third_party}
    declared = _requirement_names()
    return {
        "python": sys.version.split()[0],
        "scanned": f"{_rel(BEEGUARD)}/*.py",
        "third_party": third_party,
        "standard_library": standard,
        "declared_not_imported": [d for d in declared if d not in imported],
    }


def _installed_js_version(name: str) -> str | None:
    for base in (WEB / "node_modules", ROOT / "node_modules"):
        pkg = base / name / "package.json"
        if pkg.exists():
            try:
                return json.loads(pkg.read_text(encoding="utf-8")).get("version")
            except Exception:
                return None
    return None


def js_packages() -> dict[str, Any]:
    pkg_path = WEB / "package.json"
    if not pkg_path.exists():
        return {"packages": [], "source_files": 0}
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))

    sources = [p for p in (WEB / "src").rglob("*") if p.suffix in {".js", ".jsx", ".css"}]
    sources += [p for p in WEB.glob("vite.config.*")]
    texts = {p: p.read_text(encoding="utf-8") for p in sources}

    rows = []
    for kind in ("dependencies", "devDependencies"):
        for name, declared in sorted((pkg.get(kind) or {}).items()):
            pattern = re.compile(rf"""(?:from|import)\s*\(?\s*['"]{re.escape(name)}(?:/[^'"]*)?['"]""")
            used = sorted(_rel(p) for p, t in texts.items() if pattern.search(t))
            rows.append(
                {
                    "name": name,
                    "kind": "runtime" if kind == "dependencies" else "build",
                    "declared": declared,
                    "installed": _installed_js_version(name),
                    "imported_in": len(used),
                }
            )
    return {"manifest": _rel(pkg_path), "packages": rows, "source_files": len(sources)}


# ---------------------------------------------------------------- MCP tools


def _gated_tools() -> list[str]:
    from .policies import GATED_TOOLS

    return sorted(GATED_TOOLS)


def mcp_tools() -> dict[str, Any]:
    path = BEEGUARD / "mcp_server.py"
    if not path.exists():
        return {"server": None, "tools": []}
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text)
    gated = set(_gated_tools())

    server = None
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and getattr(node.func, "id", None) == "FastMCP"
            and node.args
            and isinstance(node.args[0], ast.Constant)
        ):
            server = node.args[0].value

    tools = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        is_tool = any(
            isinstance(d, ast.Call) and getattr(d.func, "attr", None) == "tool"
            for d in node.decorator_list
        )
        if not is_tool:
            continue
        doc = ast.get_docstring(node) or ""
        params = []
        defaults = [None] * (len(node.args.args) - len(node.args.defaults)) + list(node.args.defaults)
        for arg, default in zip(node.args.args, defaults):
            annotation = ast.unparse(arg.annotation) if arg.annotation else ""
            param = f"{arg.arg}: {annotation}" if annotation else arg.arg
            if default is not None:
                param += f" = {ast.unparse(default)}"
            params.append(param)
        tools.append(
            {
                "name": node.name,
                "summary": doc.strip().splitlines()[0] if doc else "",
                "params": params,
                "gated": node.name in gated,
                "line": node.lineno,
            }
        )
    return {"server": server, "file": _rel(path), "tools": tools}


# ------------------------------------------------------------------- agents


def _load_yaml(path: Path) -> dict:
    import yaml

    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def agents() -> dict[str, Any]:
    root_cfg = AGENTS / "config.yaml"
    if not root_cfg.exists():
        return {"orchestrator": None, "specialists": [], "policies": []}

    def describe(path: Path) -> dict[str, Any]:
        cfg = _load_yaml(path)
        prompt = (cfg.get("prompt") or "").strip()
        tools = cfg.get("tools") or {}
        bound = []
        for key, value in tools.items():
            if isinstance(value, dict):
                bound.append({"name": key, "type": value.get("type"), "members": []})
            elif isinstance(value, list):
                bound.append({"name": key, "type": "list", "members": [str(v) for v in value]})
            else:
                bound.append({"name": key, "type": None, "members": []})
        return {
            "name": cfg.get("name"),
            "description": " ".join((cfg.get("description") or "").split()),
            "harness": ((cfg.get("executor") or {}).get("config") or {}).get("harness"),
            "tools": bound,
            "prompt_words": len(prompt.split()),
            "file": _rel(path),
        }

    root = describe(root_cfg)
    specialists = [describe(p) for p in sorted((AGENTS / "agents").glob("*/config.yaml"))]

    raw = _load_yaml(root_cfg)
    policies = []
    for name, spec in ((raw.get("guardrails") or {}).get("policies") or {}).items():
        spec = spec or {}
        policies.append(
            {
                "name": name,
                "handler": spec.get("handler"),
                "params": spec.get("factory_params") or {},
            }
        )
    return {"orchestrator": root, "specialists": specialists, "policies": policies}


# ------------------------------------------------------------ lines of code

_AREAS = [
    ("Lab engine, tools, API", LAB / "beeguard", ("*.py",)),
    ("Reproduction scripts", LAB / "scripts", ("*.py",)),
    ("Web app", WEB / "src", ("**/*.jsx", "**/*.js", "**/*.css")),
    ("Agent configs", AGENTS, ("**/*.yaml",)),
    ("Shell", ROOT / "scripts", ("*.sh",)),
]


def lines_of_code() -> list[dict[str, Any]]:
    out = []
    for label, base, patterns in _AREAS:
        if not base.exists():
            continue
        files = sorted({p for pattern in patterns for p in base.glob(pattern) if p.is_file()})
        lines = 0
        for path in files:
            try:
                lines += sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
            except UnicodeDecodeError:
                continue
        out.append({"area": label, "path": _rel(base), "files": len(files), "lines": lines})
    return out


# ------------------------------------------------------------------ summary

_STATIC_TTL = 1800
_static_lock = threading.Lock()
_static_cache: dict[str, Any] = {"at": 0.0, "payload": None}
_static_refreshing = threading.Event()


def _refresh_static_in_background() -> None:
    """Rebuild the inventory off the request path. One rebuild at a time."""
    if _static_refreshing.is_set():
        return
    _static_refreshing.set()

    def work() -> None:
        try:
            with _static_lock:
                _static_cache["at"] = 0.0
                _build_static_ledger()
        except Exception:  # a failed rebuild leaves the previous payload in place
            pass
        finally:
            _static_refreshing.clear()

    threading.Thread(target=work, name="ledger-static", daemon=True).start()


def static_ledger() -> dict[str, Any]:
    """Everything that does not need the network.

    Counting files, packages and source lines takes seconds, so a built
    inventory is served straight away and rebuilt on a background thread
    once it is older than the window. ``computed_at`` says when it was built.
    """
    payload = _static_cache["payload"]
    if payload:
        if time.time() - _static_cache["at"] >= _STATIC_TTL:
            _refresh_static_in_background()
        return payload
    with _static_lock:
        if _static_cache["payload"]:
            return _static_cache["payload"]
        return _build_static_ledger()


def _build_static_ledger() -> dict[str, Any]:
    """Walk the repository and store the result. Callers hold `_static_lock`."""
    if False:
        pass
    else:
        started = time.perf_counter()
        payload = {
            "datasets": datasets(),
            "derived": derived(),
            "python": python_packages(),
            "javascript": js_packages(),
            "mcp": mcp_tools(),
            "agents": agents(),
            "lines_of_code": lines_of_code(),
        }
        payload["computed_ms"] = round((time.perf_counter() - started) * 1000)
        payload["computed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        _static_cache.update(at=time.time(), payload=payload)
        return payload


# ============================================================ method card


def _const(node: ast.AST, names: dict[str, Any]) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name) and node.id in names:
        return names[node.id]
    try:
        return ast.literal_eval(node)
    except Exception:
        return ast.unparse(node)


class _Source:
    """Reads named settings out of one module, with the line each sits on."""

    def __init__(self, path: Path):
        self.path = path
        self.text = path.read_text(encoding="utf-8")
        self.tree = ast.parse(self.text)
        self.names: dict[str, Any] = {}
        self.name_lines: dict[str, int] = {}
        for node in self.tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = node.targets[0]
                if isinstance(target, ast.Name):
                    try:
                        self.names[target.id] = ast.literal_eval(node.value)
                    except Exception:
                        continue
                    self.name_lines[target.id] = node.lineno

    def where(self, line: int) -> str:
        return f"{_rel(self.path)}:{line}"

    def constant(self, name: str) -> dict[str, Any] | None:
        if name not in self.names:
            return None
        return {"value": self.names[name], "where": self.where(self.name_lines[name])}

    def call_kwarg(self, func: str, kwarg: str) -> dict[str, Any] | None:
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "attr", None) or getattr(node.func, "id", None)
            if name != func:
                continue
            for keyword in node.keywords:
                if keyword.arg == kwarg:
                    return {
                        "value": _const(keyword.value, self.names),
                        "where": self.where(keyword.value.lineno),
                    }
        return None

    def default(self, func: str, arg: str) -> dict[str, Any] | None:
        for node in ast.walk(self.tree):
            if isinstance(node, ast.FunctionDef) and node.name == func:
                args = node.args.args
                defaults = [None] * (len(args) - len(node.args.defaults)) + list(node.args.defaults)
                for a, d in zip(args, defaults):
                    if a.arg == arg and d is not None:
                        return {"value": _const(d, self.names), "where": self.where(d.lineno)}
        return None

    def field_default(self, cls: str, field: str) -> dict[str, Any] | None:
        for node in ast.walk(self.tree):
            if isinstance(node, ast.ClassDef) and node.name == cls:
                for item in node.body:
                    if (
                        isinstance(item, ast.AnnAssign)
                        and getattr(item.target, "id", None) == field
                        and item.value is not None
                    ):
                        return {"value": _const(item.value, self.names), "where": self.where(item.lineno)}
        return None

    def line_of(self, needle: str) -> str | None:
        for number, line in enumerate(self.text.splitlines(), start=1):
            if needle in line:
                return self.where(number)
        return None


def _budget_bounds(api: _Source) -> dict[str, Any] | None:
    for node in ast.walk(api.tree):
        if (
            isinstance(node, ast.Compare)
            and len(node.comparators) == 2
            and getattr(node.comparators[0], "attr", None) == "budget"
        ):
            low = _const(node.left, {})
            high = _const(node.comparators[1], {})
            return {"value": [low, high], "where": api.where(node.lineno)}
    return None


def _strategy_names(engine: "_Source") -> dict[str, Any]:
    """The strategy names engine.order() accepts, read from its comparisons."""
    names: list[str] = []
    line = None
    for node in ast.walk(engine.tree):
        if isinstance(node, ast.FunctionDef) and node.name == "order":
            line = node.lineno
            for inner in ast.walk(node):
                if (
                    isinstance(inner, ast.Compare)
                    and isinstance(inner.left, ast.Name)
                    and inner.left.id == "strategy"
                    and len(inner.comparators) == 1
                    and isinstance(inner.comparators[0], ast.Constant)
                    and isinstance(inner.comparators[0].value, str)
                ):
                    names.append(inner.comparators[0].value)
    return {"value": names, "where": engine.where(line) if line else None}


def _decades(full: pd.DataFrame, cutoff: int) -> list[dict[str, Any]]:
    years = full["year"].dropna().astype(int)
    rows = []
    for decade in range((years.min() // 10) * 10, (years.max() // 10) * 10 + 10, 10):
        in_decade = years[(years >= decade) & (years < decade + 10)]
        if decade < 1940 and in_decade.empty:
            continue
        rows.append(
            {
                "decade": decade,
                "known": int((in_decade <= cutoff).sum()),
                "after": int((in_decade > cutoff).sum()),
            }
        )
    # Molecules before 1940 are few; fold them into one bar so the axis stays readable.
    early = [r for r in rows if r["decade"] < 1940]
    late = [r for r in rows if r["decade"] >= 1940]
    if early:
        late.insert(
            0,
            {
                "decade": "pre-1940",
                "known": sum(r["known"] for r in early),
                "after": sum(r["after"] for r in early),
            },
        )
    return late


@lru_cache(maxsize=2)
def method_card(cutoff_year: int = 2000) -> dict[str, Any]:
    """Each step of the method, with its setting read from code and its measured result."""
    from sklearn.metrics import roc_auc_score

    from .engine import get_lab

    engine = _Source(BEEGUARD / "engine.py")
    policies = _Source(BEEGUARD / "policies.py")
    api_path = BEEGUARD / "api.py"
    api = _Source(api_path) if api_path.exists() else None
    curve_path = BEEGUARD / "curve.py"
    curve = _Source(curve_path) if curve_path.exists() else None

    lab = get_lab(cutoff_year)
    facts = lab.facts()
    holdout = lab.holdout()
    full = pd.read_csv(DATA / "dataset_final.csv")
    pool_auroc = round(float(roc_auc_score(lab.pool["label"].to_numpy(), -lab.safe_score)), 4)

    runs = {}
    for budget in (30, 60):
        result = lab.run(strategy="model", budget=budget)
        runs[str(budget)] = {
            "found": result["found"],
            "targets": result["targets_total"],
            "random_median": result["random_assays_for_same_hits"],
            "speedup": result["speedup"],
            "found_at": result["found_at"],
        }

    root_cfg = AGENTS / "config.yaml"
    cap = None
    if root_cfg.exists():
        for policy in agents()["policies"]:
            if "limit" in policy["params"]:
                cap = {"value": policy["params"]["limit"], "policy": policy["name"], "where": _rel(root_cfg)}

    data_file = datasets()["files"]
    final = next((f for f in data_file if f["file"] == "dataset_final.csv"), None)

    return {
        "data": {
            "file": "lab/data/dataset_final.csv",
            "rows": int(len(full)),
            "sha256": final["sha256"] if final else None,
            "matches_manifest": final["matches_manifest"] if final else None,
            "label_column": engine.line_of('self.train["label"]'),
            "year_min": int(full["year"].min()),
            "year_max": int(full["year"].max()),
        },
        "split": {
            "cutoff_year": engine.field_default("Lab", "cutoff_year"),
            "rule": engine.line_of('full["year"] <= self.cutoff_year'),
            "train": facts["train_molecules"],
            "pool": facts["pool_molecules"],
            "decades": _decades(full, cutoff_year),
            # The dataset also ships its own time split files; baseline.py uses
            # those, the engine splits on the year column. Both are reported.
            "shipped_split": {
                f["file"]: f["rows"] for f in data_file if f["file"].startswith("time_")
            },
        },
        "model": {
            "fingerprint_radius": engine.call_kwarg("GetMorganGenerator", "radius"),
            "fingerprint_bits": engine.call_kwarg("GetMorganGenerator", "fpSize"),
            "trees": engine.call_kwarg("RandomForestClassifier", "n_estimators"),
            "seed": engine.call_kwarg("RandomForestClassifier", "random_state"),
            "trained_seconds": facts["trained_seconds"],
            "pool_auroc": pool_auroc,
        },
        "strategies": {
            "names": _strategy_names(engine)["value"],
            "defined": engine.line_of("def order("),
            "diversity_weight": engine.default("order", "diversity_weight"),
            "random_shuffles": engine.default("run", "shuffles"),
            "curve_shuffles": curve.constant("SHUFFLES") if curve else None,
        },
        "gate": {
            "gated_tools": {"value": _gated_tools(), "where": policies.line_of("GATED_TOOLS = {")},
            "returns": policies.line_of('"result": "ASK"'),
            "tool_call_cap": cap,
            "budget_bounds": _budget_bounds(api) if api else None,
        },
        "scoring": {
            "target_rule": engine.line_of('(self.pool["insecticide"] == 1) & (self.pool["label"] == 0)'),
            "targets": facts["targets"],
            "runs": runs,
        },
        "falsification": {
            "scaffold": engine.line_of("MurckoScaffold.MurckoScaffoldSmiles"),
            **holdout,
            "targets_on_unseen": facts["targets_on_unseen_scaffolds"],
            "targets": facts["targets"],
        },
    }


# ============================================================== data card


# Below this nearest-neighbour similarity a pool molecule is treated as outside
# the training data's reach.
DOMAIN_THRESHOLD = 0.4


def _nearest_neighbour_similarity(lab) -> np.ndarray:
    """Highest Tanimoto similarity of each pool molecule to any training molecule."""
    from .engine import _fingerprints

    train = _fingerprints(lab.train["SMILES"].tolist()).astype(np.float32)
    pool = lab.x_pool.astype(np.float32)
    shared = pool @ train.T
    union = pool.sum(1)[:, None] + train.sum(1)[None, :] - shared
    with np.errstate(divide="ignore", invalid="ignore"):
        similarity = np.where(union > 0, shared / union, 0.0)
    return similarity.max(axis=1)


@lru_cache(maxsize=2)
def data_card(cutoff_year: int = 2000) -> dict[str, Any]:
    from .engine import get_lab

    full = pd.read_csv(DATA / "dataset_final.csv")
    lab = get_lab(cutoff_year)

    def breakdown(column: str) -> list[dict[str, Any]]:
        rows = []
        for value, group in full.groupby(column):
            rows.append(
                {
                    "value": str(value),
                    "molecules": int(len(group)),
                    "toxic": int(group["label"].sum()),
                    "toxic_share": round(float(group["label"].mean()), 3),
                }
            )
        return sorted(rows, key=lambda r: -r["molecules"])

    nn = _nearest_neighbour_similarity(lab)
    targets = lab.is_target
    edges = np.round(np.arange(0.0, 1.0001, 0.1), 1)
    histogram = []
    for low, high in zip(edges[:-1], edges[1:]):
        in_bin = (nn >= low) & ((nn < high) if high < 1.0 else (nn <= high))
        histogram.append(
            {
                "bin": f"{low:.1f}",
                "pool": int((in_bin & ~targets).sum()),
                "answers": int((in_bin & targets).sum()),
            }
        )

    licence = _license_from_fetch_script()
    manifest = _manifests().get("dataset_final.csv", {})
    agrochemical = {
        col: int(full[col].sum())
        for col in ("herbicide", "fungicide", "insecticide", "other_agrochemical")
        if col in full.columns
    }

    strategies = _strategy_names(_Source(BEEGUARD / "engine.py"))

    # CC BY-NC 4.0 asks for credit the way the creators ask for it, which for a
    # published benchmark is the paper. Taken from the source registry rather
    # than retyped, so the card and the footer always carry the same citation.
    apistox_source = next((s for s in SOURCE_REGISTRY if s.get("id") == "apistox"), {})

    return {
        "strategies": strategies,
        "dataset": {
            "name": "ApisTox",
            "source_url": manifest.get("url"),
            "license": licence["license"],
            "license_from": licence["license_from"],
            "license_url": apistox_source.get("license_url"),
            "citation": apistox_source.get("citation"),
            "citation_doi": apistox_source.get("doi"),
            "sha256": manifest.get("sha256"),
            "molecules": int(len(full)),
            "toxic": int(full["label"].sum()),
            "non_toxic": int((full["label"] == 0).sum()),
            "year_min": int(full["year"].min()),
            "year_max": int(full["year"].max()),
            "columns": [str(c) for c in full.columns],
            "agrochemical_flags": agrochemical,
        },
        "by_source": breakdown("source") if "source" in full.columns else [],
        "by_exposure": breakdown("toxicity_type") if "toxicity_type" in full.columns else [],
        "domain": {
            "metric": "max Tanimoto similarity to any pre-cutoff molecule, Morgan r2 2048 bits",
            "pool": int(len(nn)),
            "median_pool": round(float(np.median(nn)), 3),
            "median_answers": round(float(np.median(nn[targets])), 3),
            "threshold": DOMAIN_THRESHOLD,
            "pool_below_0_4": int((nn < DOMAIN_THRESHOLD).sum()),
            "answers_below_0_4": int((nn[targets] < DOMAIN_THRESHOLD).sum()),
            "answers": int(targets.sum()),
            "histogram": histogram,
        },
        "split": {
            "cutoff_year": cutoff_year,
            "train": int(len(lab.train)),
            "pool": int(len(lab.pool)),
            "targets": int(targets.sum()),
            "unseen_scaffold_molecules": lab.facts()["unseen_scaffold_molecules"],
            "holdout": lab.holdout(),
        },
    }


# ================================================================== entry


def full_ledger(live: bool = True) -> dict[str, Any]:
    payload = dict(static_ledger())
    if live:
        payload["live"] = live_sources()
    return payload


if __name__ == "__main__":
    started = time.time()
    out = full_ledger(live=True)
    print(json.dumps(out, indent=2, default=str)[:6000])
    print(f"\n{time.time() - started:.2f}s")
