"""Reproduce the baseline the agents have to beat.

Trains on molecules known up to the year 2000 (the dataset's official time
split) and measures how well it ranks the bee-safe insecticides that were only
confirmed afterwards. Prints the numbers the demo cites, so anyone can check
them.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from rdkit import Chem, RDLogger
from rdkit.Chem import rdFingerprintGenerator
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import matthews_corrcoef, roc_auc_score

RDLogger.DisableLog("rdApp.*")

DATA = Path(__file__).resolve().parents[1] / "data"
OUT = Path(__file__).resolve().parents[1] / "results"
SEED = 0


def fingerprints(smiles: list[str]) -> np.ndarray:
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    rows = []
    for smi in smiles:
        mol = Chem.MolFromSmiles(smi)
        if mol is None:
            rows.append(np.zeros(2048, dtype=np.uint8))
            continue
        rows.append(np.array(gen.GetFingerprint(mol), dtype=np.uint8))
    return np.vstack(rows)


def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    full = pd.read_csv(DATA / "dataset_final.csv")
    train_ids = pd.read_csv(DATA / "time_train.csv")
    test_ids = pd.read_csv(DATA / "time_test.csv")
    key = "CID" if "CID" in train_ids.columns else train_ids.columns[0]
    train = full[full["CID"].isin(train_ids[key])].reset_index(drop=True)
    test = full[full["CID"].isin(test_ids[key])].reset_index(drop=True)
    return train, test


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    started = time.time()
    train, test = load()

    x_train = fingerprints(train["SMILES"].tolist())
    x_test = fingerprints(test["SMILES"].tolist())
    y_train = train["label"].to_numpy()
    y_test = test["label"].to_numpy()

    model = RandomForestClassifier(n_estimators=500, random_state=SEED, n_jobs=-1)
    model.fit(x_train, y_train)
    scores = model.predict_proba(x_test)[:, 1]

    auroc = roc_auc_score(y_test, scores)
    mcc = matthews_corrcoef(y_test, (scores >= 0.5).astype(int))
    elapsed = time.time() - started

    # The molecules the lab is trying to re-discover: insecticides that turned
    # out to be safe for bees, hidden in the post-2000 half of the data.
    targets = test[(test["insecticide"] == 1) & (test["label"] == 0)]

    summary = {
        "train_molecules": int(len(train)),
        "test_molecules": int(len(test)),
        "train_year_max": int(train["year"].max()),
        "test_year_min": int(test["year"].min()),
        "auroc": round(float(auroc), 4),
        "mcc": round(float(mcc), 4),
        "bee_safe_insecticides_in_test": int(len(targets)),
        "seconds": round(elapsed, 2),
        "seed": SEED,
    }
    (OUT / "baseline.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    for key, value in summary.items():
        print(f"{key:32s} {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
