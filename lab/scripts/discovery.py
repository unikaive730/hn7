"""Measure how much faster the lab finds bee-safe insecticides than random.

The lab only sees chemistry published up to the year 2000. It then has to order
the post-2000 molecules for testing. We count how many assays each ordering
needs to reach 3, 5, 7, 9 and all 13 of the bee-safe insecticides, and compare
against random ordering over many shuffles.

This is the number the demo reports, so it is computed here and nowhere else.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from rdkit import Chem, RDLogger
from rdkit.Chem import rdFingerprintGenerator
from rdkit.Chem.Scaffolds import MurckoScaffold
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

RDLogger.DisableLog("rdApp.*")

DATA = Path(__file__).resolve().parents[1] / "data"
OUT = Path(__file__).resolve().parents[1] / "results"
SEED = 0
SHUFFLES = 2000
MILESTONES = (3, 5, 7, 9, 13)


def fingerprints(smiles: list[str]) -> np.ndarray:
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    rows = []
    for smi in smiles:
        mol = Chem.MolFromSmiles(smi)
        rows.append(
            np.zeros(2048, dtype=np.uint8)
            if mol is None
            else np.array(gen.GetFingerprint(mol), dtype=np.uint8)
        )
    return np.vstack(rows)


def scaffold(smi: str) -> str:
    mol = Chem.MolFromSmiles(smi)
    if mol is None:
        return ""
    try:
        return MurckoScaffold.MurckoScaffoldSmiles(mol=mol)
    except Exception:
        return ""


def assays_to_find(order: np.ndarray, is_target: np.ndarray, k: int) -> int | None:
    """How many assays until the k-th target shows up in this ordering."""
    found = 0
    for position, index in enumerate(order, start=1):
        if is_target[index]:
            found += 1
            if found == k:
                return position
    return None


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    full = pd.read_csv(DATA / "dataset_final.csv")
    train_ids = pd.read_csv(DATA / "time_train.csv")
    test_ids = pd.read_csv(DATA / "time_test.csv")
    key = "CID" if "CID" in train_ids.columns else train_ids.columns[0]
    train = full[full["CID"].isin(train_ids[key])].reset_index(drop=True)
    test = full[full["CID"].isin(test_ids[key])].reset_index(drop=True)

    x_train = fingerprints(train["SMILES"].tolist())
    x_test = fingerprints(test["SMILES"].tolist())
    model = RandomForestClassifier(n_estimators=500, random_state=SEED, n_jobs=-1)
    model.fit(x_train, y := train["label"].to_numpy())

    # A molecule is worth ordering if it looks safe for bees AND is an insecticide.
    safe_score = 1.0 - model.predict_proba(x_test)[:, 1]
    is_insecticide = (test["insecticide"] == 1).to_numpy()
    priority = safe_score * is_insecticide
    is_target = ((test["insecticide"] == 1) & (test["label"] == 0)).to_numpy()
    n_targets = int(is_target.sum())

    agent_order = np.argsort(-priority, kind="stable")

    rng = np.random.default_rng(SEED)
    random_counts: dict[int, list[int]] = {k: [] for k in MILESTONES}
    pool = np.arange(len(test))
    for _ in range(SHUFFLES):
        shuffled = rng.permutation(pool)
        for k in MILESTONES:
            hit = assays_to_find(shuffled, is_target, k)
            if hit is not None:
                random_counts[k].append(hit)

    curve = []
    for k in MILESTONES:
        agent = assays_to_find(agent_order, is_target, k)
        draws = np.array(random_counts[k])
        curve.append(
            {
                "targets_found": k,
                "agent_assays": int(agent) if agent else None,
                "random_median": float(np.median(draws)),
                "random_p25": float(np.percentile(draws, 25)),
                "random_p75": float(np.percentile(draws, 75)),
                "speedup": round(float(np.median(draws) / agent), 2) if agent else None,
            }
        )

    # Does the rule the model learned hold on chemistry it has never seen?
    train_scaffolds = {scaffold(s) for s in train["SMILES"]}
    test_scaffold = np.array([scaffold(s) in train_scaffolds for s in test["SMILES"]])
    y_test = test["label"].to_numpy()
    seen_auroc = roc_auc_score(y_test[test_scaffold], safe_score[test_scaffold] * -1)
    unseen_auroc = roc_auc_score(y_test[~test_scaffold], safe_score[~test_scaffold] * -1)

    result = {
        "pool_size": int(len(test)),
        "targets": n_targets,
        "shuffles": SHUFFLES,
        "curve": curve,
        "scaffold_holdout": {
            "seen_n": int(test_scaffold.sum()),
            "seen_auroc": round(float(seen_auroc), 4),
            "unseen_n": int((~test_scaffold).sum()),
            "unseen_auroc": round(float(unseen_auroc), 4),
            "targets_on_unseen_scaffolds": int((is_target & ~test_scaffold).sum()),
        },
        "seed": SEED,
    }
    (OUT / "discovery.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(f"pool {result['pool_size']} molecules, {n_targets} bee-safe insecticides hidden\n")
    print(f"{'found':>6} {'agent':>8} {'random':>10} {'speedup':>9}")
    for row in curve:
        print(
            f"{row['targets_found']:>6} {row['agent_assays']:>8} "
            f"{row['random_median']:>10.1f} {row['speedup']:>8.2f}x"
        )
    holdout = result["scaffold_holdout"]
    print(
        f"\nscaffolds seen in training   n={holdout['seen_n']:>3}  AUROC {holdout['seen_auroc']}"
        f"\nscaffolds never seen         n={holdout['unseen_n']:>3}  AUROC {holdout['unseen_auroc']}"
        f"\n{holdout['targets_on_unseen_scaffolds']} of {n_targets} answers sit on unseen scaffolds"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
