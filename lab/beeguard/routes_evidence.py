"""HTTP routes for the literature graph.

Mount with:  app.include_router(routes_evidence.router)

The graph is read from lab/data/derived/evidence_graph.json. Passing
?refresh=1 queries the literature again (OpenAlex first, Europe PMC when
OpenAlex answers 429, PubChem for common names; the shipped build took 44
requests and about 70 s). The file is rewritten only when the new fetch is
complete.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from . import evidencegraph

router = APIRouter()


def _check_year(cutoff_year: int) -> None:
    if not 1990 <= cutoff_year <= 2015:
        raise HTTPException(400, "cutoff year must be between 1990 and 2015")


@router.get("/api/evidence/graph")
def evidence_graph(
    cutoff_year: int = 2000,
    refresh: int = Query(0, ge=0, le=1),
) -> dict:
    """Molecules, concepts and papers, linked by query and by text mention."""
    _check_year(cutoff_year)
    return evidencegraph.graph(cutoff_year, refresh=bool(refresh))


@router.get("/api/evidence/timeline")
def evidence_timeline(cutoff_year: int = 2000) -> dict:
    """Papers per year for the concept set and the hidden answers."""
    _check_year(cutoff_year)
    return evidencegraph.timeline(cutoff_year)


@router.get("/api/evidence/structure/{cid}")
def evidence_structure(cid: int) -> Response:
    """2D structure of a dataset molecule as SVG, drawn by RDKit."""
    svg = evidencegraph.structure_svg(cid)
    if svg is None:
        raise HTTPException(404, f"CID {cid} is not in this dataset")
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=86400"},
    )
