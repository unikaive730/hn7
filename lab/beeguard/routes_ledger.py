"""HTTP routes for the ledger, the method card and the data card.

Mount with ``app.include_router(routes_ledger.router)``. All paths sit under
/api/ledger. The static inventory is cached for a minute, live probes for ten.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from . import ledger

router = APIRouter()


@router.get("/api/ledger")
def get_ledger(live: bool = Query(True, description="Include live source probes")) -> dict:
    """What the lab uses: datasets, derived files, sources, packages, MCP tools, agents, code."""
    return ledger.full_ledger(live=live)


@router.get("/api/ledger/sources")
def get_sources(refresh: bool = False) -> dict:
    """One small request to each source lab code calls, with status and latency."""
    return ledger.live_sources(refresh=refresh)


@router.get("/api/ledger/method")
def get_method(cutoff_year: int = 2000) -> dict:
    """Method settings read from the source, each with file and line, plus measured results."""
    if not 1960 <= cutoff_year <= 2015:
        raise HTTPException(400, "cutoff year must be between 1960 and 2015")
    return ledger.method_card(cutoff_year)


@router.get("/api/ledger/datacard")
def get_datacard(cutoff_year: int = 2000) -> dict:
    """Composition of the data, label mix by source, and the applicability domain."""
    if not 1960 <= cutoff_year <= 2015:
        raise HTTPException(400, "cutoff year must be between 1960 and 2015")
    return ledger.data_card(cutoff_year)
