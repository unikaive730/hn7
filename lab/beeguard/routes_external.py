"""HTTP routes for the ChEMBL external test and the selective-candidate list.

Both read the JSON built by `python -m lab.beeguard.external`, so they answer
in milliseconds. If the file is missing they build it once (about a minute,
PubChem lookups included) and keep it.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from . import external

router = APIRouter()


def _payload() -> dict:
    try:
        return external.load()
    except FileNotFoundError as exc:
        raise HTTPException(503, f"ChEMBL files missing, run lab/scripts/fetch_chembl.py: {exc}")


@router.get("/api/external")
def external_validation() -> dict:
    """Honey bee LD50 records from ChEMBL, scored by a model that never saw them."""
    data = _payload()
    return {
        "chembl_fetched_at": data.get("chembl_fetched_at"),
        "built_at": data.get("built_at"),
        # The cut the cached calls were made at, so the page never hard-codes it.
        "call_threshold": external.CALL_THRESHOLD,
        **data["external"],
    }


@router.get("/api/candidates")
def candidates(
    limit: int = Query(24, ge=1, le=500),
    pest: str | None = Query(None, max_length=60),
) -> dict:
    """Pest-active ChEMBL molecules predicted bee-safe and inside the model's domain."""
    data = _payload()["candidates"]
    ranked = data["ranked"]
    if pest:
        ranked = [r for r in ranked if r["pest"].lower() == pest.lower()]
    return {
        "source": data["source"],
        "rules": data["rules"],
        "thresholds": data["thresholds"],
        "funnel": data["funnel"],
        "safe_but_out_of_domain": data["safe_but_out_of_domain"],
        "active_by_pest": data["active_by_pest"],
        "pubchem_cids_found": data["pubchem_cids_found"],
        "pubchem_lookups": data["pubchem_lookups"],
        "total_ranked": len(ranked),
        "label": "hypothesis, needs a bee assay",
        "rows": ranked[:limit],
    }
