"""HTTP routes for the agent room: bundle topology and recorded Omnigent runs."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from . import agentroom

router = APIRouter()


@router.get("/api/agents/topology")
def agents_topology() -> dict:
    """Who the orchestrator dispatches, which lab tools each agent reaches, what the policy gates."""
    return agentroom.topology()


@router.get("/api/agents/runs")
def agents_runs() -> dict:
    """Recorded runs of the beeguard-lab bundle, newest first, without turns."""
    runs = agentroom.list_runs()
    return {"runs": runs, "count": len(runs)}


@router.get("/api/agents/runs/{run_id}")
def agents_run(run_id: str) -> dict:
    """One recorded run with every turn, in the order Omnigent wrote them."""
    run = agentroom.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"no recorded run {run_id}")
    return run
