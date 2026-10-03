"""The tools the specialist agents call.

Each function is one scientific action. Omnigent exposes them by name, the
agents decide when to use them, and every call that matters writes a row to the
shared research record so the run can be reconstructed afterwards.
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from .engine import get_lab
from . import sources

RECORD = Path(__file__).resolve().parents[1] / "results" / "research_record.jsonl"


def _write(kind: str, payload: dict[str, Any]) -> str:
    """Append one row to the shared research record and return its id."""
    RECORD.parent.mkdir(parents=True, exist_ok=True)
    row_id = f"{kind}_{uuid.uuid4().hex[:8]}"
    row = {"id": row_id, "kind": kind, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), **payload}
    with RECORD.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row_id


# --------------------------------------------------------------- literature


def find_evidence(query: str, limit: int = 5) -> dict:
    """Search the live literature and file each hit as a citable evidence card.

    Args:
        query: What to look for, in plain words.
        limit: How many papers to keep per source.
    """
    openalex = sources.openalex_works(query, limit)
    europepmc = sources.europepmc_search(query, limit)
    cards = []
    for item in openalex.get("items", []):
        if not item.get("doi"):
            continue
        cards.append(
            {
                "claim_source": "OpenAlex",
                "title": item["title"],
                "year": item["year"],
                "doi": item["doi"],
                "cited_by": item["cited_by"],
                "url": item["url"],
            }
        )
    for item in europepmc.get("items", []):
        cards.append(
            {
                "claim_source": "Europe PMC",
                "title": item["title"],
                "year": item["year"],
                "doi": item.get("doi"),
                "pmid": item.get("pmid"),
                "url": item["url"],
            }
        )
    record_id = _write("evidence", {"query": query, "cards": cards, "count": len(cards)})
    return {
        "record_id": record_id,
        "query": query,
        "found": len(cards),
        "openalex_total": openalex.get("total"),
        "europepmc_total": europepmc.get("total"),
        "cards": cards,
    }


def lookup_compound(cid: int) -> dict:
    """Pull one molecule's identity and properties from PubChem and the dataset.

    Args:
        cid: PubChem compound identifier.
    """
    lab = get_lab()
    return {"dataset": lab.molecule(cid), "pubchem": sources.pubchem_compound(cid)}


# ----------------------------------------------------------------- planning


def describe_pool() -> dict:
    """Report what is in the molecule pool before any experiment is chosen."""
    lab = get_lab()
    return {**lab.facts(), "holdout": lab.holdout()}


def estimate_experiment(strategy: str, budget: int) -> dict:
    """Estimate what one candidate experiment would cost and teach.

    Used by the planner to compare competing tests before committing. It does
    not run the experiment.

    Args:
        strategy: One of model, diversity, insecticide_only.
        budget: How many assays this experiment would spend.
    """
    lab = get_lab()
    # Cost is the assay budget; expected learning is how much of the pool's
    # uncertainty this ordering is likely to resolve, approximated by the
    # share of high-uncertainty molecules it puts in front.
    order = lab.order(strategy, budget)
    uncertainty = 1.0 - abs(lab.safe_score - 0.5) * 2
    covered = float(uncertainty[order].sum())
    total = float(uncertainty.sum())
    unseen = int((~lab.seen_scaffold[order]).sum())
    expected_learning = round(covered / total, 4)
    return {
        "strategy": strategy,
        "budget": budget,
        "cost_assays": budget,
        "expected_learning": expected_learning,
        "scaffold_coverage": unseen,
        "score": round(expected_learning / (budget ** 0.5), 5),
        "note": "score favours learning per unit of cost; the planner picks the higher score",
    }


def choose_experiment(options: list[dict], reason: str) -> dict:
    """File the planner's decision: which test runs, and why the other did not.

    Args:
        options: The estimates being compared, from estimate_experiment.
        reason: Why the chosen one wins, in one sentence.
    """
    ranked = sorted(options, key=lambda o: o.get("score", 0), reverse=True)
    chosen, rejected = ranked[0], ranked[1:]
    record_id = _write(
        "decision",
        {"chosen": chosen, "rejected": rejected, "reason": reason},
    )
    return {"record_id": record_id, "chosen": chosen, "rejected": rejected, "reason": reason}


# ---------------------------------------------------------------- execution


def run_experiment(strategy: str, budget: int, diversity_weight: float = 0.15) -> dict:
    """Run the chosen experiment and file the result.

    This is the call gated behind human approval.

    Args:
        strategy: One of model, diversity, insecticide_only.
        budget: How many assays to spend.
        diversity_weight: How strongly to penalise repeating a scaffold.
    """
    lab = get_lab()
    result = lab.run(strategy=strategy, budget=budget, diversity_weight=diversity_weight)
    summary = {k: v for k, v in result.items() if k != "assays"}
    record_id = _write("experiment", summary)
    return {"record_id": record_id, **summary, "assays": result["assays"][:20]}


def test_hypothesis_on_unseen_chemistry() -> dict:
    """Check whether the learned rule survives on scaffolds never seen in training.

    This is the falsification test: it is designed to be able to fail.
    """
    lab = get_lab()
    holdout = lab.holdout()
    facts = lab.facts()
    gap = round(holdout["seen_auroc"] - holdout["unseen_auroc"], 4)
    verdict = (
        "rejected" if gap > 0.05 else "supported" if gap < 0.02 else "inconclusive"
    )
    payload = {
        **holdout,
        "gap": gap,
        "verdict": verdict,
        "targets_on_unseen_scaffolds": facts["targets_on_unseen_scaffolds"],
        "targets_total": facts["targets"],
    }
    record_id = _write("falsification", payload)
    return {"record_id": record_id, **payload}


# ------------------------------------------------------------------ record


def read_record(limit: int = 30) -> dict:
    """Read back the shared research record, so any agent can see what happened."""
    if not RECORD.exists():
        return {"rows": [], "count": 0}
    rows = [json.loads(line) for line in RECORD.read_text(encoding="utf-8").splitlines()]
    return {"rows": rows[-limit:], "count": len(rows)}


def note_next_experiment(description: str, justification: str) -> dict:
    """File what the lab would investigate next, and what result justifies it.

    Args:
        description: The next experiment, concretely.
        justification: Which result in the record makes this the right next step.
    """
    record_id = _write(
        "next_experiment", {"description": description, "justification": justification}
    )
    return {"record_id": record_id, "description": description}
