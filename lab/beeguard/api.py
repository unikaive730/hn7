"""HTTP surface for the lab, so the web demo runs the real thing.

Every endpoint computes on request. There is no recorded run being replayed:
when a judge moves the budget slider or switches strategy, the model ranks the
pool again and the numbers change with it.
"""
from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .engine import get_lab
from . import sources

app = FastAPI(
    title="BeeGuard Lab",
    description="An agentic discovery loop over bee toxicity data, running live.",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    strategy: Literal["model", "diversity", "insecticide_only"] = "model"
    budget: int = 30
    diversity_weight: float = 0.15
    cutoff_year: int = 2000


@app.get("/api/facts")
def facts(cutoff_year: int = 2000) -> dict:
    """What the lab knows before it starts: pool size, hidden answers, timing."""
    lab = get_lab(cutoff_year)
    return {**lab.facts(), "holdout": lab.holdout()}


@app.post("/api/run")
def run(request: RunRequest) -> dict:
    """Order assays with the chosen strategy and report what was found."""
    if not 5 <= request.budget <= 201:
        raise HTTPException(400, "budget must be between 5 and 201 assays")
    if not 1960 <= request.cutoff_year <= 2015:
        raise HTTPException(400, "cutoff year must be between 1960 and 2015")
    lab = get_lab(request.cutoff_year)
    return lab.run(
        strategy=request.strategy,
        budget=request.budget,
        diversity_weight=request.diversity_weight,
    )


@app.get("/api/molecule/{cid}")
def molecule(cid: int, cutoff_year: int = 2000) -> dict:
    """One molecule, with a live PubChem lookup attached."""
    lab = get_lab(cutoff_year)
    local = lab.molecule(cid)
    if local is None:
        raise HTTPException(404, f"CID {cid} is not in this dataset")
    return {"dataset": local, "pubchem": sources.pubchem_compound(cid)}


@app.get("/api/evidence")
def evidence(
    query: str = Query(..., min_length=3, max_length=200),
    limit: int = Query(5, ge=1, le=10),
) -> dict:
    """Live literature search, so claims on screen can carry a real citation."""
    return {
        "query": query,
        "openalex": sources.openalex_works(query, limit),
        "europepmc": sources.europepmc_search(query, limit),
    }


@app.get("/api/health")
def health() -> dict:
    lab = get_lab()
    return {"ok": True, "pool": lab.facts()["pool_molecules"]}
