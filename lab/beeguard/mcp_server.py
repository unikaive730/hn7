"""Expose the lab's tools over MCP, so Omnigent agents can call them.

Run as `python -m lab.beeguard.mcp_server`. Each tool here is one scientific
action; the work itself lives in tools.py.
"""
from __future__ import annotations

import json

from mcp.server.fastmcp import FastMCP

from . import tools

mcp = FastMCP("beeguard-lab")


@mcp.tool()
def find_evidence(query: str, limit: int = 5) -> str:
    """Search OpenAlex and Europe PMC live and file the hits as citable evidence cards.

    Args:
        query: What to look for, in plain words.
        limit: How many papers to keep per source.
    """
    return json.dumps(tools.find_evidence(query, limit), ensure_ascii=False)


@mcp.tool()
def lookup_compound(cid: int) -> str:
    """Look up one molecule in PubChem and in the lab's dataset.

    Args:
        cid: PubChem compound identifier.
    """
    return json.dumps(tools.lookup_compound(cid), ensure_ascii=False)


@mcp.tool()
def describe_pool() -> str:
    """Report what the lab knows before choosing an experiment: pool size, hidden answers, holdout."""
    return json.dumps(tools.describe_pool(), ensure_ascii=False)


@mcp.tool()
def estimate_experiment(strategy: str, budget: int) -> str:
    """Estimate what one candidate experiment would cost and teach, without running it.

    Args:
        strategy: One of model, diversity, insecticide_only.
        budget: How many assays this experiment would spend.
    """
    return json.dumps(tools.estimate_experiment(strategy, budget), ensure_ascii=False)


@mcp.tool()
def choose_experiment(options: list[dict], reason: str) -> str:
    """File which experiment runs and why the other one lost.

    Args:
        options: The estimates being compared, from estimate_experiment.
        reason: Why the chosen one wins, in one sentence.
    """
    return json.dumps(tools.choose_experiment(options, reason), ensure_ascii=False)


@mcp.tool()
def run_experiment(strategy: str, budget: int, diversity_weight: float = 1.0) -> str:
    """Spend the assay budget with the chosen ordering and report what was found.

    This is the call a human approves before it runs.

    Args:
        strategy: One of model, diversity, insecticide_only.
        budget: How many assays to spend.
        diversity_weight: How strongly to penalise repeating a molecular scaffold.
    """
    return json.dumps(
        tools.run_experiment(strategy, budget, diversity_weight), ensure_ascii=False
    )


@mcp.tool()
def test_hypothesis_on_unseen_chemistry() -> str:
    """Run the falsification test: does the learned rule survive on unseen scaffolds?"""
    return json.dumps(tools.test_hypothesis_on_unseen_chemistry(), ensure_ascii=False)


@mcp.tool()
def read_record(limit: int = 30) -> str:
    """Read back the shared research record so any agent can see what happened.

    Args:
        limit: How many recent rows to return.
    """
    return json.dumps(tools.read_record(limit), ensure_ascii=False)


@mcp.tool()
def note_next_experiment(description: str, justification: str) -> str:
    """File what the lab would investigate next, and which result justifies it.

    Args:
        description: The next experiment, concretely.
        justification: Which recorded result makes this the right next step.
    """
    return json.dumps(
        tools.note_next_experiment(description, justification), ensure_ascii=False
    )


if __name__ == "__main__":
    mcp.run()
