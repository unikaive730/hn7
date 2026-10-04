"""HTTP surface for the lab, so the web demo runs the real thing.

The interactive run recomputes a retrospective ranking when a judge changes
the budget or strategy. Agent panels replay saved execution records; validation
and literature panels identify their cached artifacts or live lookups.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .engine import get_lab
from . import curve as curves
from . import sources
from . import tools
from . import (
    routes_agents,
    routes_brand,
    routes_evidence,
    routes_external,
    routes_ledger,
    routes_rigor,
    routes_structures,
)

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
    budget: int = Field(30, ge=5, le=1035)
    diversity_weight: float = Field(1.0, ge=0, le=10, allow_inf_nan=False)
    cutoff_year: int = Field(2000, ge=1960, le=2015)


@app.get("/api/facts")
def facts(cutoff_year: int = Query(2000, ge=1960, le=2015)) -> dict:
    """What the lab knows before it starts: pool size, hidden answers, timing."""
    lab = get_lab(cutoff_year)
    return {**lab.facts(), "holdout": lab.holdout()}


@app.post("/api/run")
def run(request: RunRequest) -> dict:
    """Order assays with the chosen strategy and report what was found."""
    lab = get_lab(request.cutoff_year)
    if request.budget > len(lab.pool):
        raise HTTPException(400, f"budget exceeds the {len(lab.pool)} molecules available at this cutoff")
    return lab.run(
        strategy=request.strategy,
        budget=request.budget,
        diversity_weight=request.diversity_weight,
    )


@app.get("/api/molecule/{cid}")
def molecule(cid: int, cutoff_year: int = Query(2000, ge=1960, le=2015)) -> dict:
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


@app.get("/api/curve")
def discovery_curve(
    strategy: Literal["model", "diversity", "insecticide_only"] = "model",
    budget: int = Query(40, ge=5, le=1035),
    cutoff_year: int = Query(2000, ge=1960, le=2015),
) -> dict:
    """The full discovery curve, with a random band to read it against."""
    return curves.curve(strategy, budget, cutoff_year)


@app.get("/api/compare")
def compare_strategies(budget: int = Query(40, ge=5, le=1035), cutoff_year: int = Query(2000, ge=1960, le=2015)) -> dict:
    """Every ordering over the same budget, side by side."""
    return curves.compare(budget, cutoff_year)


@app.get("/api/eras")
def eras(budget: int = Query(30, ge=5, le=120)) -> dict:
    """The same question asked from 1990, 2000 and 2010."""
    return curves.across_eras(budget)


@app.get("/api/record")
def record(limit: int = Query(40, ge=1, le=200)) -> dict:
    """The shared research record the agents write to."""
    return tools.read_record(limit)


@app.get("/api/health")
def health() -> dict:
    lab = get_lab()
    return {"ok": True, "pool": lab.facts()["pool_molecules"]}


# Module routers serve recorded runs, cached analyses and live lookups.
# They go in before the static mount below, which would otherwise catch /api.
for _module in (
    routes_structures,  # registers /api/structure/smiles.svg before /{cid}.svg
    routes_agents,
    routes_rigor,
    routes_evidence,
    routes_external,
    routes_brand,
    routes_ledger,
):
    app.include_router(_module.router)


# One process can serve the built site too (deployment on a single port).
# Set WEB_DIST to the Vite output; if the folder is missing, only the API runs.
_WEB_DIST = Path(
    os.environ.get(
        "WEB_DIST",
        str(Path(__file__).resolve().parents[2] / "apps" / "web" / "dist"),
    )
)
if _WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=_WEB_DIST, html=True), name="web")
