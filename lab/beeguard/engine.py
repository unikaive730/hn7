"""The part of the lab that actually computes.

Everything the demo shows comes from here. The model is trained once at
startup on pre-2000 chemistry; after that each experiment is a ranking over
the post-2000 pool, which takes milliseconds, so a judge can change the
parameters and watch the numbers move.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from rdkit import Chem, RDLogger
from rdkit.Chem import Descriptors, rdFingerprintGenerator
from rdkit.Chem.Scaffolds import MurckoScaffold
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

RDLogger.DisableLog("rdApp.*")

DATA = Path(__file__).resolve().parents[1] / "data"
SEED = 0
FP_BITS = 2048


def _fingerprints(smiles: list[str]) -> np.ndarray:
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=FP_BITS)
    rows = []
    for smi in smiles:
        mol = Chem.MolFromSmiles(smi)
        rows.append(
            np.zeros(FP_BITS, dtype=np.uint8)
            if mol is None
            else np.array(gen.GetFingerprint(mol), dtype=np.uint8)
        )
    return np.vstack(rows)


def _scaffold(smi: str) -> str:
    mol = Chem.MolFromSmiles(smi)
    if mol is None:
        return ""
    try:
        return MurckoScaffold.MurckoScaffoldSmiles(mol=mol)
    except Exception:
        return ""


@dataclass
class Lab:
    """Holds the trained model and the molecule pool the agents reason over."""

    cutoff_year: int = 2000
    train: pd.DataFrame = field(init=False)
    pool: pd.DataFrame = field(init=False)
    safe_score: np.ndarray = field(init=False)
    is_target: np.ndarray = field(init=False)
    seen_scaffold: np.ndarray = field(init=False)
    trained_seconds: float = field(init=False)

    def __post_init__(self) -> None:
        started = time.time()
        full = pd.read_csv(DATA / "dataset_final.csv")
        full = full[full["year"].notna()].reset_index(drop=True)

        self.train = full[full["year"] <= self.cutoff_year].reset_index(drop=True)
        self.pool = full[full["year"] > self.cutoff_year].reset_index(drop=True)

        x_train = _fingerprints(self.train["SMILES"].tolist())
        x_pool = _fingerprints(self.pool["SMILES"].tolist())
        model = RandomForestClassifier(n_estimators=500, random_state=SEED, n_jobs=-1)
        model.fit(x_train, self.train["label"].to_numpy())

        self.safe_score = 1.0 - model.predict_proba(x_pool)[:, 1]
        self.is_target = (
            (self.pool["insecticide"] == 1) & (self.pool["label"] == 0)
        ).to_numpy()

        train_scaffolds = {_scaffold(s) for s in self.train["SMILES"]}
        self.pool_scaffolds = [_scaffold(s) for s in self.pool["SMILES"]]
        self.seen_scaffold = np.array([s in train_scaffolds for s in self.pool_scaffolds])

        self.x_pool = x_pool
        self.trained_seconds = round(time.time() - started, 2)

    # ------------------------------------------------------------------ facts

    def facts(self) -> dict:
        return {
            "cutoff_year": self.cutoff_year,
            "train_molecules": int(len(self.train)),
            "pool_molecules": int(len(self.pool)),
            "targets": int(self.is_target.sum()),
            "targets_on_unseen_scaffolds": int((self.is_target & ~self.seen_scaffold).sum()),
            "unseen_scaffold_molecules": int((~self.seen_scaffold).sum()),
            "trained_seconds": self.trained_seconds,
        }

    def holdout(self) -> dict:
        """Does the learned rule survive on chemistry it never saw?"""
        y = self.pool["label"].to_numpy()
        risk = -self.safe_score
        seen, unseen = self.seen_scaffold, ~self.seen_scaffold
        return {
            "seen_n": int(seen.sum()),
            "seen_auroc": round(float(roc_auc_score(y[seen], risk[seen])), 4),
            "unseen_n": int(unseen.sum()),
            "unseen_auroc": round(float(roc_auc_score(y[unseen], risk[unseen])), 4),
        }

    # ------------------------------------------------------------- strategies

    def _diversity_order(self, budget: int, weight: float) -> np.ndarray:
        """Rank by predicted safety, but discount scaffolds already picked.

        This is the strategy the lab proposes after seeing the holdout result:
        if most answers live on unfamiliar scaffolds, stop spending the budget
        on near-duplicates of what we already ordered.
        """
        priority = self.safe_score * (self.pool["insecticide"] == 1).to_numpy()
        picked_scaffolds: dict[str, int] = {}
        order: list[int] = []
        remaining = set(range(len(self.pool)))
        while remaining and len(order) < budget:
            best, best_value = None, -np.inf
            for idx in remaining:
                seen_count = picked_scaffolds.get(self.pool_scaffolds[idx], 0)
                value = priority[idx] - weight * seen_count
                if value > best_value:
                    best, best_value = idx, value
            order.append(best)
            remaining.discard(best)
            scaffold = self.pool_scaffolds[best]
            picked_scaffolds[scaffold] = picked_scaffolds.get(scaffold, 0) + 1
        return np.array(order, dtype=int)

    def order(self, strategy: str, budget: int, diversity_weight: float = 1.0) -> np.ndarray:
        """Return the molecule indices to assay, in the order the lab picks."""
        if strategy == "model":
            priority = self.safe_score * (self.pool["insecticide"] == 1).to_numpy()
            return np.argsort(-priority, kind="stable")[:budget]
        if strategy == "diversity":
            return self._diversity_order(budget, diversity_weight)
        if strategy == "insecticide_only":
            idx = np.flatnonzero((self.pool["insecticide"] == 1).to_numpy())
            rng = np.random.default_rng(SEED)
            return rng.permutation(idx)[:budget]
        raise ValueError(f"unknown strategy: {strategy}")

    # ------------------------------------------------------------- experiment

    def run(
        self,
        strategy: str = "model",
        budget: int = 30,
        diversity_weight: float = 1.0,
        shuffles: int = 500,
    ) -> dict:
        """Order `budget` assays with `strategy` and report what was found."""
        started = time.time()
        order = self.order(strategy, budget, diversity_weight)

        found_at: list[int] = []
        rows = []
        hits = 0
        for position, idx in enumerate(order, start=1):
            hit = bool(self.is_target[idx])
            if hit:
                hits += 1
                found_at.append(position)
            rows.append(
                {
                    "position": position,
                    "name": str(self.pool.loc[idx, "name"]),
                    "cid": int(self.pool.loc[idx, "CID"]),
                    "year": int(self.pool.loc[idx, "year"]),
                    "safe_score": round(float(self.safe_score[idx]), 4),
                    "scaffold_seen": bool(self.seen_scaffold[idx]),
                    "is_target": hit,
                }
            )

        random_median = self._random_baseline(hits, shuffles) if hits else None
        speedup = round(random_median / budget, 2) if random_median else None

        return {
            "strategy": strategy,
            "budget": int(budget),
            "diversity_weight": diversity_weight,
            "found": hits,
            "targets_total": int(self.is_target.sum()),
            "found_at": found_at,
            "random_assays_for_same_hits": random_median,
            "speedup": speedup,
            "on_unseen_scaffolds": int(
                sum(1 for r in rows if r["is_target"] and not r["scaffold_seen"])
            ),
            "assays": rows,
            "seconds": round(time.time() - started, 3),
        }

    def _random_baseline(self, hits: int, shuffles: int) -> float:
        """How many random assays would it take to find the same number?"""
        rng = np.random.default_rng(SEED)
        pool_size = len(self.pool)
        counts = []
        for _ in range(shuffles):
            shuffled = rng.permutation(pool_size)
            found = 0
            for position, idx in enumerate(shuffled, start=1):
                if self.is_target[idx]:
                    found += 1
                    if found == hits:
                        counts.append(position)
                        break
        return float(np.median(counts)) if counts else None

    # ------------------------------------------------------------- molecules

    def molecule(self, cid: int) -> dict | None:
        match = self.pool[self.pool["CID"] == cid]
        if match.empty:
            match = self.train[self.train["CID"] == cid]
            if match.empty:
                return None
        row = match.iloc[0]
        mol = Chem.MolFromSmiles(row["SMILES"])
        return {
            "name": str(row["name"]),
            "cid": int(row["CID"]),
            "smiles": str(row["SMILES"]),
            "year": int(row["year"]),
            "label": int(row["label"]),
            "insecticide": int(row["insecticide"]),
            "scaffold": _scaffold(row["SMILES"]),
            "molecular_weight": round(Descriptors.MolWt(mol), 2) if mol else None,
            "logp": round(Descriptors.MolLogP(mol), 2) if mol else None,
        }


@lru_cache(maxsize=4)
def get_lab(cutoff_year: int = 2000) -> Lab:
    return Lab(cutoff_year=cutoff_year)


if __name__ == "__main__":
    lab = get_lab()
    print(json.dumps(lab.facts(), indent=2))
    print(json.dumps(lab.holdout(), indent=2))
    for strategy in ("model", "diversity", "insecticide_only"):
        result = lab.run(strategy=strategy, budget=30)
        print(
            f"{strategy:18s} found {result['found']:>2}/{result['targets_total']} "
            f"in {result['budget']} assays, random needs "
            f"{result['random_assays_for_same_hits']}, {result['speedup']}x, "
            f"{result['seconds']}s"
        )
