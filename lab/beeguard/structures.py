"""Chemistry made visible: structure drawings, the hidden answers, and a map.

Three things live here.

1. 2D structure drawings (RDKit, SVG) tuned for a dark page.
2. The hidden answers for a cutoff year: the insecticides dated after the
   cutoff that ApisTox records as safe for honey bees, with the rank at which
   the learned ordering asked for each one and what random order needs.
3. A 2D map of chemical space: t-SNE over Tanimoto distance between Morgan
   fingerprints, the same fingerprints the model is trained on.

Nothing is typed in by hand. Ranks come from ``Lab.order``, random baselines
replay the exact shuffles ``Lab._random_baseline`` uses, similarities are
computed from fingerprints, and names come from the dataset or, when the
dataset only has a long systematic name, from a PubChem title lookup that is
cached to ``lab/data/derived/pubchem_titles.json``.
"""
from __future__ import annotations

import json
import re
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from rdkit import Chem, RDLogger
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Chem.Scaffolds import MurckoScaffold

from .engine import DATA, SEED, _fingerprints, _scaffold, get_lab

RDLogger.DisableLog("rdApp.*")

DERIVED = DATA / "derived"
TITLES_FILE = DERIVED / "pubchem_titles.json"
COMMON_FILE = DERIVED / "pubchem_common_names.json"
SHUFFLES = 500  # same count as Lab.run() passes to _random_baseline
MAX_SMILES = 400
LONG_NAME = 34  # dataset names longer than this get a PubChem title for display

# --------------------------------------------------------------------- drawing

# Soft colours that read on #0a0a0f. Carbon and bonds are near-white; the
# heteroatoms the chemistry turns on (N, O, halogens) get distinct hues.
_PALETTE = {
    -1: (0.86, 0.86, 0.90),
    0: (0.86, 0.86, 0.90),
    1: (0.70, 0.70, 0.76),
    6: (0.86, 0.86, 0.90),
    7: (0.55, 0.74, 0.98),   # N  soft blue
    8: (0.98, 0.55, 0.60),   # O  soft rose
    9: (0.53, 0.90, 0.66),   # F  mint
    15: (0.99, 0.70, 0.40),  # P  orange
    16: (0.99, 0.82, 0.30),  # S  amber
    17: (0.45, 0.85, 0.55),  # Cl green
    35: (0.93, 0.55, 0.40),  # Br rust
    53: (0.75, 0.55, 0.95),  # I  violet
}
_SCAFFOLD_TINT = (0.98, 0.75, 0.14, 0.26)


@lru_cache(maxsize=1)
def _smiles_by_cid() -> dict[int, tuple[str, str]]:
    # Five CIDs appear twice in ApisTox with different SMILES (all dated before
    # 2001). Keep the first row, as Lab.molecule() does.
    frame = pd.read_csv(DATA / "dataset_final.csv")
    out: dict[int, tuple[str, str]] = {}
    for r in frame.itertuples():
        out.setdefault(int(r.CID), (str(r.SMILES), str(r.name)))
    return out


def _scaffold_match(mol: Chem.Mol) -> tuple[list[int], list[int]]:
    """Atom and bond indices of the Bemis-Murcko scaffold inside ``mol``."""
    try:
        core = MurckoScaffold.GetScaffoldForMol(mol)
    except Exception:
        return [], []
    if core is None or core.GetNumAtoms() == 0:
        return [], []
    atoms = list(mol.GetSubstructMatch(core))
    if not atoms:
        return [], []
    keep = set(atoms)
    bonds = [
        b.GetIdx()
        for b in mol.GetBonds()
        if b.GetBeginAtomIdx() in keep and b.GetEndAtomIdx() in keep
    ]
    return atoms, bonds


@lru_cache(maxsize=4096)
def svg_for_smiles(smiles: str, size: int = 240, scaffold: bool = False) -> str | None:
    """Return an SVG string, or None if RDKit cannot parse the SMILES."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    rdMolDraw2D.PrepareMolForDrawing(mol, addChiralHs=False)

    drawer = rdMolDraw2D.MolDraw2DSVG(size, size)
    opts = drawer.drawOptions()
    opts.clearBackground = False
    opts.setBackgroundColour((0, 0, 0, 0))
    opts.updateAtomPalette(_PALETTE)
    opts.setSymbolColour((0.86, 0.86, 0.90))
    opts.setAnnotationColour((0.86, 0.86, 0.90))
    opts.addStereoAnnotation = False
    opts.bondLineWidth = 1.6 if size >= 200 else 1.2
    opts.padding = 0.06
    opts.minFontSize = 10 if size >= 200 else 7
    opts.fillHighlights = True
    opts.highlightBondWidthMultiplier = 16

    if scaffold:
        # Bonds only: per-atom highlight discs made the drawing look blotchy.
        _, bonds = _scaffold_match(mol)
        drawer.DrawMolecule(
            mol,
            highlightAtoms=[],
            highlightBonds=bonds,
            highlightBondColors={b: _SCAFFOLD_TINT for b in bonds},
        )
    else:
        drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def svg_for_cid(cid: int, size: int = 240, scaffold: bool = False) -> str | None:
    entry = _smiles_by_cid().get(int(cid))
    if entry is None:
        return None
    return svg_for_smiles(entry[0], size, scaffold)


def valid_smiles(smiles: str) -> bool:
    return 0 < len(smiles) <= MAX_SMILES and Chem.MolFromSmiles(smiles) is not None


# ----------------------------------------------------------------------- names

_REF = re.compile(r"\s*\(Ref:[^)]*\)\s*", re.I)


def _load_titles() -> dict[str, str]:
    if TITLES_FILE.exists():
        try:
            return json.loads(TITLES_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def fetch_pubchem_titles(cids: list[int], batch: int = 150) -> dict[str, str]:
    """Look up PubChem record titles in batches and merge them into the cache.

    Uses the HTTP client from ``sources.py`` so headers and timeouts match the
    rest of the lab. A failed batch is skipped, never filled in.
    """
    from . import sources

    titles = _load_titles()
    todo = [c for c in cids if str(c) not in titles]
    with sources._client() as client:
        for start in range(0, len(todo), batch):
            chunk = todo[start : start + batch]
            url = (
                "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/"
                f"{','.join(map(str, chunk))}/property/Title/JSON"
            )
            try:
                resp = client.get(url)
                resp.raise_for_status()
                for row in resp.json()["PropertyTable"]["Properties"]:
                    if row.get("Title"):
                        titles[str(row["CID"])] = row["Title"]
            except Exception:
                continue
            time.sleep(0.25)
    DERIVED.mkdir(parents=True, exist_ok=True)
    TITLES_FILE.write_text(json.dumps(titles, indent=0, sort_keys=True), encoding="utf-8")
    _titles.cache_clear()
    return titles


@lru_cache(maxsize=1)
def _titles() -> dict[str, str]:
    return _load_titles()


_COMMON = re.compile(r"^[A-Za-z][a-z-]{3,24}$")


def fetch_common_names(cids: list[int], batch: int = 60) -> dict[str, str]:
    """For molecules whose names are long systematic strings, find a one-word
    common name among the PubChem synonyms (e.g. Spirotetramat). The first
    synonym that is a single alphabetic word is taken; if none, nothing is
    stored and the long name stays.

    Only run this on the hidden answers. Across the whole dataset the same rule
    picks trade names and misspellings (checked 2026-10-04: Applaud, Zelan,
    Thiamethaxam), so the map keeps the dataset or PubChem title instead."""
    from . import sources

    found = {}
    if COMMON_FILE.exists():
        found = json.loads(COMMON_FILE.read_text(encoding="utf-8"))
    todo = [c for c in cids if str(c) not in found]
    with sources._client() as client:
        for start in range(0, len(todo), batch):
            chunk = todo[start : start + batch]
            url = (
                "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/"
                f"{','.join(map(str, chunk))}/synonyms/JSON"
            )
            try:
                resp = client.get(url)
                resp.raise_for_status()
                for info in resp.json()["InformationList"]["Information"]:
                    pick = next((s for s in info.get("Synonym", []) if _COMMON.match(s)), None)
                    if pick:
                        found[str(info["CID"])] = pick[0].upper() + pick[1:]
            except Exception:
                continue
            time.sleep(0.25)
    DERIVED.mkdir(parents=True, exist_ok=True)
    COMMON_FILE.write_text(json.dumps(found, indent=0, sort_keys=True), encoding="utf-8")
    _common.cache_clear()
    return found


@lru_cache(maxsize=1)
def _common() -> dict[str, str]:
    if COMMON_FILE.exists():
        try:
            return json.loads(COMMON_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def display_name(cid: int, name: str | None) -> tuple[str, str]:
    """A short name for the screen and where it came from."""
    cleaned = _REF.sub(" ", name or "").strip()
    title = _titles().get(str(int(cid)))
    if cleaned and len(cleaned) <= LONG_NAME:
        return cleaned, "dataset"
    if title and len(title) <= LONG_NAME:
        return title, "pubchem"
    common = _common().get(str(int(cid)))
    if common:
        return common, "pubchem synonym"
    if title and len(title) < max(len(cleaned), 1):
        return title, "pubchem"
    if cleaned:
        return cleaned, "dataset"
    if title:
        return title, "pubchem"
    return f"CID {cid}", "cid"


# ------------------------------------------------------------------ similarity


def _tanimoto(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Tanimoto similarity between every row of ``a`` and every row of ``b``."""
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    inter = a @ b.T
    union = a.sum(1)[:, None] + b.sum(1)[None, :] - inter
    with np.errstate(divide="ignore", invalid="ignore"):
        sim = np.where(union > 0, inter / union, 0.0)
    return sim


# --------------------------------------------------------------- hidden answers


def _random_kth_medians(is_target: np.ndarray, shuffles: int = SHUFFLES) -> list[float]:
    """Median assays random order needs to reach its k-th answer, k = 1..K.

    Replays the shuffles of ``Lab._random_baseline``: a fresh generator seeded
    with SEED, ``shuffles`` permutations of the pool. For k = K this returns the
    same number the engine reports as ``random_assays_for_same_hits``.
    """
    rng = np.random.default_rng(SEED)
    n = len(is_target)
    total = int(is_target.sum())
    positions = np.zeros((shuffles, total), dtype=np.int32)
    for row in range(shuffles):
        shuffled = rng.permutation(n)
        hit_positions = np.flatnonzero(is_target[shuffled]) + 1
        positions[row] = hit_positions[:total]
    return [float(np.median(positions[:, k])) for k in range(total)]


@lru_cache(maxsize=8)
def hidden(cutoff_year: int = 2000) -> dict:
    lab = get_lab(cutoff_year)
    pool = lab.pool
    n = len(pool)
    total = int(lab.is_target.sum())

    order = lab.order("model", n)
    rank_of = {int(idx): pos for pos, idx in enumerate(order, start=1)}
    kth_random = _random_kth_medians(lab.is_target)

    target_idx = np.flatnonzero(lab.is_target)
    x_train = _fingerprints(lab.train["SMILES"].tolist())
    sim = _tanimoto(lab.x_pool[target_idx], x_train)

    rows = []
    for j, idx in enumerate(target_idx):
        idx = int(idx)
        cid = int(pool.loc[idx, "CID"])
        name = str(pool.loc[idx, "name"]) if pd.notna(pool.loc[idx, "name"]) else None
        short, short_src = display_name(cid, name)
        nn = int(np.argmax(sim[j]))
        nn_cid = int(lab.train.loc[nn, "CID"])
        nn_short, _ = display_name(nn_cid, str(lab.train.loc[nn, "name"]))
        rows.append(
            {
                "cid": cid,
                "name": name,
                "display_name": short,
                "display_name_source": short_src,
                "year": int(pool.loc[idx, "year"]),
                "smiles": str(pool.loc[idx, "SMILES"]),
                "scaffold": lab.pool_scaffolds[idx],
                "seen_scaffold": bool(lab.seen_scaffold[idx]),
                "safe_score": round(float(lab.safe_score[idx]), 4),
                "model_rank": rank_of[idx],
                "nearest_known": {
                    "cid": nn_cid,
                    "name": nn_short,
                    "year": int(lab.train.loc[nn, "year"]),
                    "label": "toxic" if int(lab.train.loc[nn, "label"]) == 1 else "non-toxic",
                    "tanimoto": round(float(sim[j, nn]), 3),
                },
            }
        )

    rows.sort(key=lambda r: r["model_rank"])
    for k, row in enumerate(rows, start=1):
        row["find_order"] = k
        row["random_rank_median"] = kth_random[k - 1]
        # Exact expectation of the k-th of K marked items in a random order of n.
        row["random_rank_expected"] = round(k * (n + 1) / (total + 1), 1)

    model_last = rows[-1]["model_rank"] if rows else None
    random_last = kth_random[-1] if kth_random else None
    return {
        "cutoff_year": cutoff_year,
        "pool_molecules": n,
        "train_molecules": int(len(lab.train)),
        "targets": total,
        "unseen_scaffold_targets": int(sum(1 for r in rows if not r["seen_scaffold"])),
        "model_rank_of_last": model_last,
        "random_median_for_all": random_last,
        "shuffles": SHUFFLES,
        "definition": "insecticide == 1 and label == 0 among molecules dated after the cutoff",
        "rows": rows,
    }


# ------------------------------------------------------------- chemical space


@lru_cache(maxsize=1)
def _embedding() -> dict:
    """t-SNE coordinates for every dated molecule. Independent of the cutoff."""
    from sklearn.manifold import TSNE

    frame = pd.read_csv(DATA / "dataset_final.csv")
    frame = frame[frame["year"].notna()].reset_index(drop=True)
    fps = _fingerprints(frame["SMILES"].tolist())
    dist = 1.0 - _tanimoto(fps, fps)
    np.fill_diagonal(dist, 0.0)
    dist = np.clip(dist, 0.0, 1.0)
    started = time.time()
    coords = TSNE(
        n_components=2,
        metric="precomputed",
        init="random",
        perplexity=30,
        random_state=SEED,
    ).fit_transform(dist)
    return {
        "cids": frame["CID"].astype(int).tolist(),
        "coords": coords,
        "seconds": round(time.time() - started, 2),
    }


def _space_file(cutoff_year: int) -> Path:
    return DERIVED / f"space_{cutoff_year}.json"


def _quantiles(values: np.ndarray) -> dict:
    if len(values) == 0:
        return {"n": 0}
    return {
        "n": int(len(values)),
        "median": round(float(np.median(values)), 3),
        "q25": round(float(np.percentile(values, 25)), 3),
        "q75": round(float(np.percentile(values, 75)), 3),
    }


def build_space(cutoff_year: int = 2000) -> dict:
    lab = get_lab(cutoff_year)
    frame = pd.read_csv(DATA / "dataset_final.csv")
    frame = frame[frame["year"].notna()].reset_index(drop=True)

    emb = _embedding()
    assert emb["cids"] == frame["CID"].astype(int).tolist()
    dup_cids = set(frame.loc[frame["CID"].duplicated(keep=False), "CID"].astype(int))

    pool_pos = {(int(c), s): i for i, (c, s) in enumerate(zip(lab.pool["CID"], lab.pool["SMILES"]))}
    train_scaffolds = {_scaffold(s) for s in lab.train["SMILES"]}

    # Nearest pre-cutoff neighbour, measured in fingerprint space, not on the map.
    x_train = _fingerprints(lab.train["SMILES"].tolist())
    nn_sim = _tanimoto(lab.x_pool, x_train).max(axis=1)

    points = []
    for i, row in enumerate(frame.itertuples()):
        cid = int(row.CID)
        x, y = emb["coords"][i]
        in_pool = int(row.year) > cutoff_year
        p = pool_pos.get((cid, row.SMILES)) if in_pool else None
        short, _ = display_name(cid, str(row.name))
        if cid in dup_cids:
            # display_name may pick a PubChem title that belongs to the other row
            short = _REF.sub(" ", str(row.name)).strip()
        points.append(
            {
                "id": i,
                "cid": cid,
                # only for rows whose CID is shared with a different molecule,
                # so the client can draw the right structure
                **({"smiles": str(row.SMILES)} if cid in dup_cids else {}),
                "name": short,
                "x": round(float(x), 3),
                "y": round(float(y), 3),
                "year": int(row.year),
                "label": "toxic" if int(row.label) == 1 else "non-toxic",
                "insecticide": bool(int(row.insecticide)),
                "split": "pool" if in_pool else "train",
                "is_target": bool(lab.is_target[p]) if p is not None else False,
                "seen_scaffold": bool(lab.seen_scaffold[p])
                if p is not None
                else _scaffold(row.SMILES) in train_scaffolds,
                "nn_train_tanimoto": round(float(nn_sim[p]), 3) if p is not None else None,
            }
        )

    tgt = lab.is_target
    seen = lab.seen_scaffold
    summary = {
        "pool_all": _quantiles(nn_sim),
        "pool_seen_scaffold": _quantiles(nn_sim[seen]),
        "pool_unseen_scaffold": _quantiles(nn_sim[~seen]),
        "targets_seen_scaffold": _quantiles(nn_sim[tgt & seen]),
        "targets_unseen_scaffold": _quantiles(nn_sim[tgt & ~seen]),
    }

    return {
        "cutoff_year": cutoff_year,
        "method": (
            "t-SNE (scikit-learn, perplexity 30, random_state 0, random init) on "
            "1 - Tanimoto between Morgan fingerprints (radius 2, 2048 bits)"
        ),
        "tsne_seconds": emb["seconds"],
        "counts": {
            "points": len(points),
            "shared_cid_rows": len([p for p in points if "smiles" in p]),
            "train": sum(1 for p in points if p["split"] == "train"),
            "pool": sum(1 for p in points if p["split"] == "pool"),
            "targets": sum(1 for p in points if p["is_target"]),
            "toxic": sum(1 for p in points if p["label"] == "toxic"),
        },
        "nearest_known_similarity": summary,
        "points": points,
    }


@lru_cache(maxsize=8)
def space(cutoff_year: int = 2000) -> dict:
    path = _space_file(cutoff_year)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    payload = build_space(cutoff_year)
    try:
        DERIVED.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    except OSError:
        pass  # read-only deploy: keep the in-memory copy
    return payload


if __name__ == "__main__":
    import sys

    frame = pd.read_csv(DATA / "dataset_final.csv")
    if "--titles" in sys.argv:
        got = fetch_pubchem_titles(frame["CID"].astype(int).tolist())
        print(f"titles cached: {len(got)} of {len(frame)}")
    if "--common" in sys.argv:
        COMMON_FILE.unlink(missing_ok=True)
        lab = get_lab(2000)
        targets = lab.pool[lab.is_target]
        long_ones = [
            int(r.CID)
            for r in targets.itertuples()
            if len(display_name(int(r.CID), str(r.name))[0]) > LONG_NAME
        ]
        got = fetch_common_names(long_ones)
        print(f"long names: {len(long_ones)}, common names found: {len(got)}")
    if "--space" in sys.argv:
        _space_file(2000).unlink(missing_ok=True)
        space.cache_clear()
        out = space(2000)
        print(json.dumps({k: v for k, v in out.items() if k != "points"}, indent=2))
    report = hidden(2000)
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=2))
    for r in report["rows"]:
        print(
            f"#{r['find_order']:>2} rank {r['model_rank']:>3}  random {r['random_rank_median']:>5}"
            f"  seen={r['seen_scaffold']!s:5}  nn {r['nearest_known']['tanimoto']:.3f}"
            f"  {r['display_name']} ({r['display_name_source']})"
        )
