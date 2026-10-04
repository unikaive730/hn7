"""ChEMBL as a second and third dataset: an outside test and a candidate list.

Two questions, both answered from records fetched by lab/scripts/fetch_chembl.py:

1. External test. ChEMBL files a handful of honey bee LD50 values from papers
   ApisTox did not curate. We label them with the same EPA rule ApisTox uses
   (LD50 below 11 ug per bee is toxic), then score them with a model that never
   saw those molecules: every ChEMBL bee molecule is removed from the training
   set first, matched by InChIKey connectivity block.

2. Selective candidates. ChEMBL also holds thousands of potency records on crop
   pests. Molecules that kill a pest at a low concentration, are predicted
   bee-safe and sit close enough to ApisTox chemistry for that prediction to
   mean something are listed as hypotheses for a bee assay. Nothing here says a
   molecule is safe; it says which ones are worth testing first.

Build once, then the API serves the cached JSON:

    PYTHONUTF8=1 PYTHONPATH=. lab/.venv/Scripts/python.exe -m lab.beeguard.external
"""
from __future__ import annotations

import json
import re
import time
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import Descriptors, rdFingerprintGenerator
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

from .engine import FP_BITS, SEED

RDLogger.DisableLog("rdApp.*")

DATA = Path(__file__).resolve().parents[1] / "data"
DERIVED = DATA / "derived"
CACHE = DERIVED / "chembl_external.json"

EPA_TOXIC_UG_PER_BEE = 11.0  # ApisTox / US EPA cut-off for acute LD50
ACTIVE_MG_PER_L = 10.0  # pest potency cut-off used for candidates (mg/L = ppm)
MORTALITY_ACTIVE_PCT = 80.0  # a mortality record counts if this many died
DOMAIN_MIN_SIMILARITY = 0.3  # max Tanimoto to ApisTox below this = out of domain
SAFE_MIN_SCORE = 0.5
CALL_THRESHOLD = 0.5  # P(toxic) at or above this is scored as a toxic call

# Units that are a concentration in mg/L, or convert to it by a fixed factor.
MG_PER_L_FACTOR = {
    "mg l-1": 1.0,
    "mg/l": 1.0,
    "mg.l-1": 1.0,
    "ug ml-1": 1.0,
    "ug/ml": 1.0,
    "ug.ml-1": 1.0,
    "ppm": 1.0,
    "mgai/l": 1.0,
    "ugai/ml": 1.0,
    "ug l-1": 0.001,
    "ug/l": 0.001,
    "ug.l-1": 0.001,
    "ng/ml": 0.001,
    "ng ml-1": 0.001,
    "ng.ml-1": 0.001,
    "mg/ml": 1000.0,
    "mg ml-1": 1000.0,
    "mg.ml-1": 1000.0,
}
MOLAR_TO_UM = {"nm": 0.001, "um": 1.0, "mm": 1000.0, "m": 1e6}
# LC80/LC90 are upper bounds on the LC50, so using them only makes a molecule look weaker.
POTENCY_TYPES = {"LC50", "LD50", "EC50", "IC50", "KD50", "LC80", "LC90", "EC80", "EC90"}

_GEN = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=FP_BITS)


# ----------------------------------------------------------------- chemistry


def _mol(smiles: str | float):
    if not isinstance(smiles, str) or not smiles:
        return None
    return Chem.MolFromSmiles(smiles)


def _parent_key(mol) -> str | None:
    """InChIKey connectivity block. Two salts or stereo forms of one molecule match."""
    if mol is None:
        return None
    try:
        key = Chem.MolToInchiKey(mol)
    except Exception:
        return None
    return key.split("-")[0] if key else None


def _fp(mol):
    return _GEN.GetFingerprint(mol)


def _fp_matrix(fps) -> np.ndarray:
    rows = np.zeros((len(fps), FP_BITS), dtype=np.uint8)
    for i, fp in enumerate(fps):
        DataStructs.ConvertToNumpyArray(fp, rows[i])
    return rows


@lru_cache(maxsize=1)
def _apistox() -> pd.DataFrame:
    df = pd.read_csv(DATA / "dataset_final.csv")
    mols = [_mol(s) for s in df["SMILES"]]
    df = df.assign(_mol=mols)
    df = df[df["_mol"].notna()].reset_index(drop=True)
    df["key"] = [_parent_key(m) for m in df["_mol"]]
    df["fp"] = [_fp(m) for m in df["_mol"]]
    return df


def _train(train: pd.DataFrame) -> RandomForestClassifier:
    model = RandomForestClassifier(n_estimators=500, random_state=SEED, n_jobs=-1)
    model.fit(_fp_matrix(list(train["fp"])), train["label"].to_numpy())
    return model


def _neighbour(fp, train: pd.DataFrame) -> tuple[float, int]:
    sims = DataStructs.BulkTanimotoSimilarity(fp, list(train["fp"]))
    best = int(np.argmax(sims))
    return float(sims[best]), best


# ------------------------------------------------------------ external test


def _label_bee(group: pd.DataFrame) -> tuple[int | None, str]:
    """One label per molecule, ApisTox style: toxic if any LD50 says toxic."""
    calls = []
    for _, row in group.iterrows():
        value, rel = row["standard_value"], str(row["standard_relation"] or "=")
        if pd.isna(value):
            continue
        value = float(value)
        if rel in ("=", "<", "<=", "~") and value < EPA_TOXIC_UG_PER_BEE:
            calls.append(1)
        elif rel in ("=", ">", ">=", "~") and value >= EPA_TOXIC_UG_PER_BEE:
            calls.append(0)
    if not calls:
        return None, "no decidable LD50"
    if 1 in calls:
        return 1, f"{len(calls)} LD50 record(s), lowest below 11 ug/bee"
    return 0, f"{len(calls)} LD50 record(s), all at or above 11 ug/bee"


def _bee_records() -> pd.DataFrame:
    raw = pd.read_csv(DATA / "chembl_apis.csv")
    units = raw["standard_units"].fillna("").str.lower()
    keep = (raw["standard_type"] == "LD50") & units.isin(["ug", "ug.bee-1", "ug/bee"])
    return raw[keep].copy()


def build_external() -> dict:
    apistox = _apistox()
    raw = pd.read_csv(DATA / "chembl_apis.csv")
    ld50 = _bee_records()

    molecules = []
    for (species, chembl_id), group in ld50.groupby(["target_organism", "molecule_chembl_id"]):
        smiles = group["canonical_smiles"].dropna().iloc[0] if group["canonical_smiles"].notna().any() else None
        mol = _mol(smiles)
        label, why = _label_bee(group)
        if mol is None or label is None:
            continue
        values = [
            f"{r.standard_relation}{float(r.standard_value):g}"
            for r in group.itertuples()
            if not pd.isna(r.standard_value)
        ]
        molecules.append(
            {
                "species": species,
                "chembl_id": chembl_id,
                "name": str(group["molecule_pref_name"].dropna().iloc[0]).title()
                if group["molecule_pref_name"].notna().any()
                else chembl_id,
                "smiles": smiles,
                "key": _parent_key(mol),
                "fp": _fp(mol),
                "label": label,
                "label_basis": why,
                "ld50_ug_per_bee": values,
                "year": int(group["document_year"].dropna().iloc[0])
                if group["document_year"].notna().any()
                else None,
                "assays": sorted(group["assay_chembl_id"].unique().tolist()),
            }
        )

    keys_in_test = {m["key"] for m in molecules}
    in_apistox = {k: i for i, k in enumerate(apistox["key"])}
    train = apistox[~apistox["key"].isin(keys_in_test)].reset_index(drop=True)
    model = _train(train)

    rows = []
    for m in molecules:
        p_toxic = float(model.predict_proba(_fp_matrix([m["fp"]]))[0, 1])
        sim, nn = _neighbour(m["fp"], train)
        overlap = in_apistox.get(m["key"])
        rows.append(
            {
                "species": m["species"],
                "chembl_id": m["chembl_id"],
                "name": m["name"],
                "smiles": m["smiles"],
                "year": m["year"],
                "ld50_ug_per_bee": m["ld50_ug_per_bee"],
                "chembl_label": m["label"],
                "label_basis": m["label_basis"],
                "p_toxic": round(p_toxic, 4),
                "called_toxic": p_toxic >= CALL_THRESHOLD,
                "correct": (p_toxic >= CALL_THRESHOLD) == bool(m["label"]),
                "max_similarity": round(sim, 3),
                "in_domain": sim >= DOMAIN_MIN_SIMILARITY,
                "nearest_name": str(train.loc[nn, "name"]),
                "nearest_label": int(train.loc[nn, "label"]),
                "nearest_smiles": str(train.loc[nn, "SMILES"]),
                "in_apistox": overlap is not None,
                "apistox_label": int(apistox.loc[overlap, "label"]) if overlap is not None else None,
                "apistox_cid": int(apistox.loc[overlap, "CID"]) if overlap is not None else None,
                "name_in_apistox": bool(
                    overlap is None and apistox["name"].str.lower().str.contains(m["name"].lower(), regex=False).any()
                ),
                "assays": m["assays"],
            }
        )

    def summarise(subset: list[dict]) -> dict:
        y = np.array([r["chembl_label"] for r in subset], dtype=int)
        p = np.array([r["p_toxic"] for r in subset], dtype=float)
        both = len(set(y.tolist())) == 2
        called = [r for r in subset if r["called_toxic"]]
        return {
            "n": len(subset),
            "toxic": int(y.sum()),
            "nontoxic": int(len(y) - y.sum()),
            "auroc": round(float(roc_auc_score(y, p)), 3) if both else None,
            "auroc_note": None if both else "only one class present, AUROC undefined",
            # AUROC as a plain count: toxic/non-toxic pairs the model orders correctly.
            "pairs_ordered": int(sum(pt > pn for pt in p[y == 1] for pn in p[y == 0])) if both else None,
            "pairs_total": int((y == 1).sum() * (y == 0).sum()) if both else None,
            "correct": int(sum(r["correct"] for r in subset)),
            "toxic_calls": len(called),
            "toxic_call_precision": round(sum(r["chembl_label"] for r in called) / len(called), 3)
            if called
            else None,
            "out_of_domain": int(sum(not r["in_domain"] for r in subset)),
            "in_domain_n": int(sum(r["in_domain"] for r in subset)),
            "in_domain_correct": int(sum(r["correct"] for r in subset if r["in_domain"])),
            "out_of_domain_correct": int(sum(r["correct"] for r in subset if not r["in_domain"])),
        }

    honey = [r for r in rows if r["species"] == "Apis mellifera"]
    bumble = [r for r in rows if r["species"] == "Bombus terrestris"]
    new_honey = [r for r in honey if not r["in_apistox"]]
    overlap = [r for r in honey if r["in_apistox"]]
    agree = sum(r["chembl_label"] == r["apistox_label"] for r in overlap)

    # Same molecule measured on both species: does a honey bee label carry over?
    by_name = {r["chembl_id"]: r for r in honey}
    species_pairs = [
        {
            "name": b["name"],
            "honey_bee_ld50": by_name[b["chembl_id"]]["ld50_ug_per_bee"],
            "honey_bee_label": by_name[b["chembl_id"]]["chembl_label"],
            "bumblebee_ld50": b["ld50_ug_per_bee"],
            "bumblebee_label": b["chembl_label"],
        }
        for b in bumble
        if b["chembl_id"] in by_name
    ]

    apis_raw = raw[raw["target_organism"] == "Apis mellifera"]
    return {
        "source": "ChEMBL organism targets CHEMBL612665 (Apis mellifera) and CHEMBL2367044 (Bombus terrestris)",
        "rule": f"LD50 below {EPA_TOXIC_UG_PER_BEE:g} ug per bee = toxic; toxic if any record says toxic",
        "model": "RandomForest, 500 trees, Morgan r=2 2048 bits, trained on ApisTox minus every ChEMBL bee molecule",
        "train_molecules": int(len(train)),
        "domain_min_similarity": DOMAIN_MIN_SIMILARITY,
        "chembl_records": {
            "apis_all": int(len(apis_raw)),
            "apis_molecules": int(apis_raw["molecule_chembl_id"].nunique()),
            "apis_ld50": int((ld50["target_organism"] == "Apis mellifera").sum()),
            "bombus_all": int((raw["target_organism"] == "Bombus terrestris").sum()),
            "bombus_ld50": int((ld50["target_organism"] == "Bombus terrestris").sum()),
        },
        "honey_bee": summarise(honey) if honey else None,
        "honey_bee_new": summarise(new_honey) if new_honey else {"n": 0},
        "label_agreement": {"overlap": len(overlap), "agree": int(agree)},
        "bumblebee": summarise(bumble) if bumble else None,
        "species_pairs": species_pairs,
        "species_disagree": int(sum(p["honey_bee_label"] != p["bumblebee_label"] for p in species_pairs)),
        "rows": rows,
    }


# --------------------------------------------------------------- candidates


_CONC = re.compile(
    r"at\s+([0-9]*\.?[0-9]+)\s*(mg/l|mg l-1|ug/ml|ug ml-1|ppm|mg a\.i\./l|mg ai/l|mg/ml|ug/l)",
    re.I,
)


def _to_mg_per_l(value: float, units: str, mw: float | None) -> float | None:
    u = units.strip().lower()
    if u in MG_PER_L_FACTOR:
        return value * MG_PER_L_FACTOR[u]
    if u in MOLAR_TO_UM and mw:
        return value * MOLAR_TO_UM[u] * mw / 1000.0
    return None


# Only records that measure killing the pest count. Immune or feeding assays and
# fumigation (an air concentration, not comparable with a leaf-dip mg/L) are left out.
_LETHAL = re.compile(r"insecticid|larvicid|mortalit|toxicity|lethal|kill|aphicid|nymphicid|ovicid", re.I)
_NOT_LETHAL = re.compile(r"fumigat|immune|nodulation|antifeed|repell|oviposition|feeding deterr", re.I)


def _potency(row, mw: float | None) -> tuple[float | None, str | None]:
    """Return a concentration in mg/L that kills the pest, and how it was read."""
    desc = str(row.assay_description or "")
    if not _LETHAL.search(desc) or _NOT_LETHAL.search(desc):
        return None, None
    stype = str(row.standard_type or "")
    units = str(row.standard_units or "")
    rel = str(row.standard_relation or "=")
    if pd.isna(row.standard_value):
        return None, None
    value = float(row.standard_value)
    if stype in POTENCY_TYPES and rel in ("=", "<", "<=", "~"):
        mg = _to_mg_per_l(value, units, mw)
        if mg is not None and mg > 0:
            return mg, stype
    if stype.lower() in ("mortality", "activity", "insecticidal activity") and units == "%":
        if value >= MORTALITY_ACTIVE_PCT and rel in ("=", ">", ">="):
            match = _CONC.search(str(row.assay_description or ""))
            if match:
                conc_units = match.group(2).lower().replace("mg a.i./l", "mg/l").replace("mg ai/l", "mg/l")
                mg = _to_mg_per_l(float(match.group(1)), conc_units, mw)
                if mg is not None and mg > 0:
                    return mg, f"{value:g}% killed"
    return None, None


@lru_cache(maxsize=1)
def _full_model() -> RandomForestClassifier:
    return _train(_apistox())


def _pubchem_cids(keys: list[str]) -> dict[str, int]:
    """Look up PubChem CIDs by full InChIKey. Missing ones stay missing."""
    found: dict[str, int] = {}
    with httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        for key in keys:
            try:
                resp = client.get(
                    f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/{key}/cids/JSON"
                )
                if resp.status_code == 200:
                    cids = resp.json().get("IdentifierList", {}).get("CID", [])
                    if cids:
                        found[key] = int(cids[0])
            except Exception:
                pass
            time.sleep(0.22)  # PubChem asks for at most 5 requests per second
    return found


def build_candidates(lookup_limit: int = 80) -> dict:
    apistox = _apistox()
    apistox_keys = set(apistox["key"])
    raw = pd.read_csv(DATA / "chembl_pests.csv")
    funnel = {"records": int(len(raw)), "molecules": int(raw["molecule_chembl_id"].nunique())}

    smiles_by_id = (
        raw.dropna(subset=["canonical_smiles"]).groupby("molecule_chembl_id")["canonical_smiles"].first()
    )
    chem: dict[str, dict] = {}
    for chembl_id, smiles in smiles_by_id.items():
        mol = _mol(smiles)
        if mol is None:
            continue
        chem[chembl_id] = {
            "mol": mol,
            "smiles": smiles,
            "key": _parent_key(mol),
            "full_key": Chem.MolToInchiKey(mol),
            "mw": Descriptors.MolWt(mol),
        }
    funnel["valid_smiles"] = len(chem)
    chem = {k: v for k, v in chem.items() if v["key"] not in apistox_keys}
    funnel["not_in_apistox"] = len(chem)

    best: dict[str, dict] = {}
    pest_counts: dict[str, int] = {}
    for row in raw[raw["molecule_chembl_id"].isin(chem.keys())].itertuples():
        info = chem[row.molecule_chembl_id]
        mg, how = _potency(row, info["mw"])
        if mg is None:
            continue
        current = best.get(row.molecule_chembl_id)
        if current is None or mg < current["potency_mg_l"]:
            best[row.molecule_chembl_id] = {
                "pest": row.target_organism,
                "potency_mg_l": mg,
                "potency_basis": how,
                "assay": row.assay_chembl_id,
                "assay_description": str(row.assay_description or "")[:180],
                "document": row.document_chembl_id,
                "year": None if pd.isna(row.document_year) else int(row.document_year),
                "name": None if pd.isna(row.molecule_pref_name) else str(row.molecule_pref_name),
            }
    funnel["with_potency"] = len(best)
    active = {k: v for k, v in best.items() if v["potency_mg_l"] <= ACTIVE_MG_PER_L}
    funnel["active"] = len(active)

    model = _full_model()
    ids = list(active.keys())
    fps = [_fp(chem[i]["mol"]) for i in ids]
    p_toxic = model.predict_proba(_fp_matrix(fps))[:, 1] if ids else np.array([])

    rows = []
    for idx, chembl_id in enumerate(ids):
        sim, nn = _neighbour(fps[idx], apistox)
        rec = active[chembl_id]
        pest_counts[rec["pest"]] = pest_counts.get(rec["pest"], 0) + 1
        rows.append(
            {
                "chembl_id": chembl_id,
                "name": rec["name"].title() if rec["name"] else None,
                "smiles": chem[chembl_id]["smiles"],
                "inchikey": chem[chembl_id]["full_key"],
                "pest": rec["pest"],
                "potency_mg_l": round(rec["potency_mg_l"], 4),
                "potency_basis": rec["potency_basis"],
                "assay": rec["assay"],
                "assay_description": rec["assay_description"],
                "document": rec["document"],
                "year": rec["year"],
                "bee_safe_score": round(float(1.0 - p_toxic[idx]), 4),
                "max_similarity": round(sim, 3),
                "in_domain": sim >= DOMAIN_MIN_SIMILARITY,
                "nearest_name": str(apistox.loc[nn, "name"]),
                "nearest_cid": int(apistox.loc[nn, "CID"]),
                "nearest_smiles": str(apistox.loc[nn, "SMILES"]),
                "nearest_label": int(apistox.loc[nn, "label"]),
                "cid": None,
            }
        )
    safe = [r for r in rows if r["bee_safe_score"] >= SAFE_MIN_SCORE]
    funnel["predicted_bee_safe"] = len(safe)
    ranked = [r for r in safe if r["in_domain"]]
    funnel["in_domain"] = len(ranked)
    ranked.sort(key=lambda r: (-r["bee_safe_score"], r["potency_mg_l"]))

    cids = _pubchem_cids([r["inchikey"] for r in ranked[:lookup_limit]])
    for r in ranked:
        r["cid"] = cids.get(r["inchikey"])

    out_of_domain_safe = len(safe) - len(ranked)
    return {
        "source": "ChEMBL organism targets for 11 crop pest insects",
        "rules": {
            "active": f"lethal assay only; lowest LC50/LD50/EC50 at or below {ACTIVE_MG_PER_L:g} mg/L, "
            f"or at least {MORTALITY_ACTIVE_PCT:g}% killed at a stated dose at or below it; fumigation excluded",
            "bee_safe": f"1 - P(toxic) from a RandomForest trained on all ApisTox molecules, at or above {SAFE_MIN_SCORE}",
            "domain": f"max Tanimoto to ApisTox at or above {DOMAIN_MIN_SIMILARITY}",
            "sort": "bee-safe score, then potency",
        },
        "thresholds": {
            "active_mg_per_l": ACTIVE_MG_PER_L,
            "mortality_pct": MORTALITY_ACTIVE_PCT,
            "bee_safe_min": SAFE_MIN_SCORE,
            "domain_min_similarity": DOMAIN_MIN_SIMILARITY,
        },
        "funnel": funnel,
        "safe_but_out_of_domain": out_of_domain_safe,
        "active_by_pest": dict(sorted(pest_counts.items(), key=lambda kv: -kv[1])),
        "pubchem_cids_found": len(cids),
        "pubchem_lookups": min(lookup_limit, len(ranked)),
        "ranked": ranked,
        "all_active": rows,
    }


# --------------------------------------------------------------------- cache


def build(write: bool = True) -> dict:
    started = time.time()
    manifest = json.loads((DATA / "chembl_manifest.json").read_text(encoding="utf-8"))
    payload = {
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "chembl_fetched_at": manifest.get("fetched_at"),
        "chembl_sha256": {k: v["sha256"] for k, v in manifest["files"].items()},
        "external": build_external(),
        "candidates": build_candidates(),
    }
    payload["build_seconds"] = round(time.time() - started, 1)
    if write:
        DERIVED.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    return payload


@lru_cache(maxsize=1)
def load() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return build(write=True)


if __name__ == "__main__":
    result = build(write=True)
    ext, cand = result["external"], result["candidates"]
    print("external honey bee:", json.dumps(ext["honey_bee"]))
    print("external honey bee, not in ApisTox:", json.dumps(ext["honey_bee_new"]))
    print("label agreement on overlap:", json.dumps(ext["label_agreement"]))
    print("bumblebee:", json.dumps(ext["bumblebee"]))
    print("candidate funnel:", json.dumps(cand["funnel"]))
    print("active by pest:", json.dumps(cand["active_by_pest"]))
    print("pubchem cids:", cand["pubchem_cids_found"], "of", cand["pubchem_lookups"])
    for r in cand["ranked"][:10]:
        print(
            f"  {r['chembl_id']:>14} {r['pest']:<22} {r['potency_mg_l']:>9.3g} mg/L "
            f"safe {r['bee_safe_score']:.2f} sim {r['max_similarity']:.2f} nn {r['nearest_name']}"
        )
    print("built in", result["build_seconds"], "s ->", CACHE)
