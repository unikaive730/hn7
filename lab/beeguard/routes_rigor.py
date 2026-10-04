"""HTTP routes for the learning loop and the rigor checks.

Both read precomputed files from lab/data/derived/ (rebuilt with
`python -m lab.beeguard.rigor`), so they answer in milliseconds. A learning
configuration that was not precomputed is computed once and cached to disk.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from . import rigor

router = APIRouter()


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
    return rigor.get_rigor()
