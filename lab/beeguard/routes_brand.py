"""Routes for the site frame: the data-source list the footer shows."""
from __future__ import annotations

from fastapi import APIRouter, Query

from . import brand

router = APIRouter()


@router.get("/api/sources")
def data_sources() -> dict:
    """Sources with a real call site in the code, with licence and location."""
    return brand.sources()


@router.get("/api/headline")
def headline(cutoff_year: int = Query(2000, ge=1960, le=2015), budget: int = Query(30, ge=5, le=1035)) -> dict:
    """Facts, the model run at this budget, and the full pool order (for the tape figure)."""
    return brand.headline(cutoff_year, budget)
