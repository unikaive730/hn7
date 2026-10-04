"""HTTP routes for the learning loop and the rigor checks.

Both read precomputed files from lab/data/derived/ (rebuilt with
`python -m lab.beeguard.rigor`), so they answer in milliseconds. A learning
configuration that was not precomputed is computed once and cached to disk.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from sklearn.metrics import roc_auc_score

from . import rigor
from .engine import _scaffold, get_lab

router = APIRouter()


@lru_cache(maxsize=2)
def _acyclic_scaffold_check(cutoff_year: int = 2000) -> dict:
    """The scaffold split recomputed with acyclic molecules counted as unseen.

    `engine._scaffold()` returns an empty string for a molecule with no ring
    system. Training molecules carry that empty scaffold too, so every acyclic
    pool molecule matches it and lands in the "scaffold seen in training"
    bucket by artefact rather than by shared chemistry. This recomputes the two
    AUROCs with those molecules moved across, on the same model and the same
    split, so the page can state the size of the artefact without moving the
    published figures in rigor.json.
    """
    lab = get_lab(cutoff_year)
    pool_scaffolds = lab.pool_scaffolds
    train_scaffolds = [_scaffold(s) for s in lab.train["SMILES"]]
    known = {s for s in train_scaffolds}
    acyclic_pool = np.array([s == "" for s in pool_scaffolds])
    fixed_seen = np.array([(s in known and s != "") for s in pool_scaffolds])
    y = lab.pool["label"].to_numpy()
    risk = -lab.safe_score
    return {
        "train_molecules_without_a_ring": int(sum(1 for s in train_scaffolds if s == "")),
        "pool_molecules_without_a_ring": int(acyclic_pool.sum()),
        "moved_out_of_seen": int((acyclic_pool & lab.seen_scaffold).sum()),
        "seen_n": int(fixed_seen.sum()),
        "seen_auroc": round(float(roc_auc_score(y[fixed_seen], risk[fixed_seen])), 4),
        "unseen_n": int((~fixed_seen).sum()),
        "unseen_auroc": round(float(roc_auc_score(y[~fixed_seen], risk[~fixed_seen])), 4),
        "targets_on_unseen_scaffolds": int((lab.is_target & ~fixed_seen).sum()),
    }


@router.get("/api/learning")
def learning(
    budget: int = Query(60, ge=10, le=201),
    batch: int = Query(10, ge=5, le=50),
) -> dict:
    """Active learning rounds with retraining, against the same budget frozen."""
    if -(-budget // batch) > 40:  # rounds, counting a final partial batch
        raise HTTPException(400, "at most 40 rounds; raise the batch size or lower the budget")
    return rigor.get_learning(budget, batch)


@router.get("/api/rigor")
def rigor_checks() -> dict:
    """Random-baseline distributions, ablations, scaffold split, seed spread."""
    payload = rigor.get_rigor()
    scaffold = payload.get("scaffold")
    if isinstance(scaffold, dict):
        cutoff = int(payload.get("setup", {}).get("cutoff_year", 2000))
        try:
            scaffold["acyclic_check"] = _acyclic_scaffold_check(cutoff)
        except Exception as exc:  # the caveat is optional; the checks are not
            scaffold["acyclic_check_error"] = str(exc)
    return payload
