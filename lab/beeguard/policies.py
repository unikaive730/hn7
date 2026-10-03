"""Policies that bound what the lab may do on its own.

The approval gate is the point: an agent can propose and compare experiments
all it likes, but spending the assay budget is a decision a person makes. The
boundary lives here, in code the agents cannot edit, rather than in a sentence
in a prompt asking them to behave.
"""
from __future__ import annotations

from typing import Any

# Calls that commit the assay budget. Everything else the lab does is reading
# and reasoning, which needs no approval.
GATED_TOOLS = {
    "run_experiment",
    "test_hypothesis_on_unseen_chemistry",
}

_ALLOW: dict[str, Any] = {"result": "ALLOW"}


def ask_before_experiment(event: dict[str, Any]) -> dict[str, Any]:
    """Pause for human approval before an experiment consumes assay budget.

    :param event: Policy event from Omnigent.
    :returns: ASK with a readable summary for gated tools, ALLOW otherwise.
    """
    if event.get("type") != "tool_call":
        return _ALLOW
    data = event.get("data")
    if not isinstance(data, dict):
        return _ALLOW

    tool = data.get("name", "")
    if tool not in GATED_TOOLS:
        return _ALLOW

    args = data.get("arguments") or {}
    if tool == "run_experiment":
        summary = (
            f"Spend {args.get('budget', '?')} assays using the "
            f"'{args.get('strategy', '?')}' ordering"
        )
    else:
        summary = "Run the falsification test on unseen chemistry"

    return {
        "result": "ASK",
        "reason": f"{summary}. A scientist approves before the lab spends budget.",
    }
