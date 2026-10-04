"""HTTP routes for structure drawings, the hidden answers and the chemical map.

Mount with ``app.include_router(routes_structures.router)``.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from . import structures

router = APIRouter()

_SVG_HEADERS = {"Cache-Control": "public, max-age=86400, immutable"}


def _check_cutoff(cutoff_year: int) -> None:
    if not 1960 <= cutoff_year <= 2015:
        raise HTTPException(400, "cutoff year must be between 1960 and 2015")


# Registered before the {cid} route so "smiles" is not parsed as a CID.
@router.get("/api/structure/smiles.svg")
def structure_from_smiles(
    smiles: str = Query(..., min_length=1, max_length=structures.MAX_SMILES),
    size: int = Query(240, ge=60, le=640),
    scaffold: bool = False,
) -> Response:
    """2D drawing of any SMILES, for a dark background."""
    svg = structures.svg_for_smiles(smiles, size, scaffold)
    if svg is None:
        raise HTTPException(400, "RDKit could not parse this SMILES")
    return Response(svg, media_type="image/svg+xml", headers=_SVG_HEADERS)


@router.get("/api/structure/{cid}.svg")
def structure_from_cid(
    cid: int,
    size: int = Query(240, ge=60, le=640),
    scaffold: bool = False,
) -> Response:
    """2D drawing of an ApisTox molecule by PubChem CID. ``scaffold=true``
    tints the Bemis-Murcko scaffold amber."""
    svg = structures.svg_for_cid(cid, size, scaffold)
    if svg is None:
        raise HTTPException(404, f"CID {cid} is not in the ApisTox dataset")
    return Response(svg, media_type="image/svg+xml", headers=_SVG_HEADERS)


@router.get("/api/hidden")
def hidden_answers(cutoff_year: int = 2000) -> dict:
    """The answers the lab has to find, with the rank the learned ordering
    reached each one and the median rank random order needs for the same
    count."""
    _check_cutoff(cutoff_year)
    return structures.hidden(cutoff_year)


@router.get("/api/space")
def chemical_space(cutoff_year: int = 2000) -> dict:
    """Every dated molecule on a 2D t-SNE map of fingerprint space."""
    _check_cutoff(cutoff_year)
    return structures.space(cutoff_year)
