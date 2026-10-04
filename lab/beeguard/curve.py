"""Discovery curves: how many assays each ordering needs, step by step.

The single speedup number is the headline; this is the shape behind it. It
shows where an ordering is strong, where it flattens out, and how far it sits
from random across the whole run rather than at one point.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np

from .engine import get_lab

SHUFFLES = 400
# The API default for Lab.order(); named here so the comparison can report it.
DIVERSITY_WEIGHT = 1.0


def _cumulative_hits(order: np.ndarray, is_target: np.ndarray) -> list[int]:
    """Running count of answers found after each assay."""
    found = 0
    out = []
    for index in order:
        if is_target[index]:
            found += 1
        out.append(found)
    return out


@lru_cache(maxsize=16)
def curve(strategy: str, budget: int, cutoff_year: int = 2000) -> dict:
    """The agent's curve, with a random band to compare it against."""
    lab = get_lab(cutoff_year)
    requested_budget = budget
    budget = min(budget, len(lab.pool))
    order = lab.order(strategy, budget)
    agent = _cumulative_hits(order, lab.is_target)

    rng = np.random.default_rng(0)
    draws = np.zeros((SHUFFLES, budget), dtype=np.int16)
    pool = len(lab.pool)
    for row in range(SHUFFLES):
        shuffled = rng.permutation(pool)[:budget]
        draws[row] = _cumulative_hits(shuffled, lab.is_target)

    points = []
    for step in range(budget):
        column = draws[:, step]
        points.append(
            {
                "assay": step + 1,
                "agent": agent[step],
                "random_median": float(np.median(column)),
                "random_low": float(np.percentile(column, 10)),
                "random_high": float(np.percentile(column, 90)),
            }
        )

    return {
        "strategy": strategy,
        "budget": budget,
        "requested_budget": requested_budget,
        "targets": int(lab.is_target.sum()),
        "shuffles": SHUFFLES,
        "points": points,
    }


def compare(budget: int = 40, cutoff_year: int = 2000) -> dict:
    """Run every strategy over the same budget so they can be read side by side.

    Comparing on "assays to reach the same count" hides the difference once
    every strategy finds everything, so the comparison here is what each one
    found inside the same budget, against what random finds in that budget.
    """
    lab = get_lab(cutoff_year)
    requested_budget = budget
    budget = min(budget, len(lab.pool))

    rng = np.random.default_rng(0)
    random_shuffles = 300
    random_found = []
    for _ in range(random_shuffles):
        picks = rng.permutation(len(lab.pool))[:budget]
        random_found.append(int(lab.is_target[picks].sum()))
    random_median = float(np.median(random_found))

    insecticide = (lab.pool["insecticide"] == 1).to_numpy()
    diversity_weight = DIVERSITY_WEIGHT
    rows = []
    for strategy in ("model", "diversity", "insecticide_only"):
        order = lab.order(strategy, budget, diversity_weight)
        hits = int(lab.is_target[order].sum())
        scaffolds = len({lab.pool_scaffolds[i] for i in order})
        positions = [p + 1 for p, i in enumerate(order) if lab.is_target[i]]
        rows.append(
            {
                "strategy": strategy,
                "found": hits,
                "scaffolds_covered": scaffolds,
                "on_unseen_scaffolds": int((~lab.seen_scaffold[order] & lab.is_target[order]).sum()),
                "first_hit": positions[0] if positions else None,
                "vs_random": round(hits / random_median, 2) if random_median else None,
                # Only insecticides can be answers, so a pick outside that class
                # is budget the ordering cannot win with. The diversity penalty
                # is subtracted from a score in [0, 1], so at weight 1 a repeated
                # scaffold falls below the non-insecticides, which sit at 0.
                "outside_insecticides": int((~insecticide[order]).sum()),
                # insecticide_only is a single seeded permutation, not a distribution.
                "single_draw": strategy == "insecticide_only",
            }
        )
    return {
        "budget": budget,
        "requested_budget": requested_budget,
        "targets": int(lab.is_target.sum()),
        "random_median_found": random_median,
        "random_shuffles": random_shuffles,
        "diversity_weight": diversity_weight,
        "rows": rows,
    }


def across_eras(budget: int = 30) -> dict:
    """Re-run the same question from three different points in history.

    The lab is not tuned to one cutoff: move the clock and it re-trains on
    whatever was known by then, and the pool of answers changes with it.
    """
    out = []
    for year in (1990, 2000, 2010):
        lab = get_lab(year)
        facts = lab.facts()
        if facts["targets"] == 0:
            out.append({"cutoff_year": year, **facts, "speedup": None, "found": 0})
            continue
        result = lab.run(strategy="model", budget=budget, shuffles=200)
        out.append(
            {
                "cutoff_year": year,
                "train_molecules": facts["train_molecules"],
                "pool_molecules": facts["pool_molecules"],
                "targets": facts["targets"],
                "found": result["found"],
                "budget": result["budget"],
                "speedup": result["speedup"],
                "holdout_gap": round(
                    lab.holdout()["seen_auroc"] - lab.holdout()["unseen_auroc"], 4
                ),
            }
        )
    return {"budget": budget, "eras": out}
