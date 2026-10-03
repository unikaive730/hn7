"""Live lookups against the public scientific sources the brief points to.

Nothing here is cached from a previous run or hard-coded: each call goes out to
the real service when a judge asks for evidence. If a service is unreachable the
caller gets an explicit miss, never an invented answer.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

CONTACT = "hn7-beeguard"
TIMEOUT = httpx.Timeout(12.0, connect=6.0)
HEADERS = {"User-Agent": f"{CONTACT} (Hack-Nation 7 submission)"}


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, headers=HEADERS, follow_redirects=True)


def openalex_works(query: str, limit: int = 5) -> dict[str, Any]:
    """Papers and citation counts from OpenAlex."""
    started = time.time()
    try:
        with _client() as client:
            resp = client.get(
                "https://api.openalex.org/works",
                params={"search": query, "per-page": limit, "mailto": "ceo@marketpilot.it"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        return {"source": "OpenAlex", "ok": False, "error": str(exc)[:200], "items": []}

    items = []
    for work in data.get("results", [])[:limit]:
        items.append(
            {
                "title": work.get("title"),
                "year": work.get("publication_year"),
                "doi": (work.get("doi") or "").replace("https://doi.org/", ""),
                "cited_by": work.get("cited_by_count"),
                "url": work.get("doi") or work.get("id"),
                "venue": (work.get("primary_location") or {}).get("source", {}).get("display_name")
                if (work.get("primary_location") or {}).get("source")
                else None,
            }
        )
    return {
        "source": "OpenAlex",
        "ok": True,
        "total": data.get("meta", {}).get("count"),
        "items": items,
        "seconds": round(time.time() - started, 2),
    }


def europepmc_search(query: str, limit: int = 5) -> dict[str, Any]:
    """Biomedical and ecotoxicology literature from Europe PMC."""
    started = time.time()
    try:
        with _client() as client:
            resp = client.get(
                "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                params={"query": query, "format": "json", "pageSize": limit},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        return {"source": "Europe PMC", "ok": False, "error": str(exc)[:200], "items": []}

    items = [
        {
            "title": r.get("title"),
            "year": r.get("pubYear"),
            "journal": r.get("journalTitle"),
            "pmid": r.get("pmid"),
            "doi": r.get("doi"),
            "url": f"https://europepmc.org/article/{r.get('source')}/{r.get('id')}",
        }
        for r in data.get("resultList", {}).get("result", [])[:limit]
    ]
    return {
        "source": "Europe PMC",
        "ok": True,
        "total": data.get("hitCount"),
        "items": items,
        "seconds": round(time.time() - started, 2),
    }


def pubchem_compound(cid: int) -> dict[str, Any]:
    """Identity and computed properties straight from PubChem."""
    started = time.time()
    props = "MolecularFormula,MolecularWeight,XLogP,CanonicalSMILES,IUPACName"
    try:
        with _client() as client:
            resp = client.get(
                f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/property/{props}/JSON"
            )
            resp.raise_for_status()
            row = resp.json()["PropertyTable"]["Properties"][0]
    except Exception as exc:
        return {"source": "PubChem", "ok": False, "error": str(exc)[:200]}

    return {
        "source": "PubChem",
        "ok": True,
        "cid": cid,
        "formula": row.get("MolecularFormula"),
        "molecular_weight": row.get("MolecularWeight"),
        "xlogp": row.get("XLogP"),
        "iupac_name": row.get("IUPACName"),
        "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
        "seconds": round(time.time() - started, 2),
    }


def arxiv_search(query: str, limit: int = 4) -> dict[str, Any]:
    """Method papers from arXiv (used for the experiment-selection literature)."""
    started = time.time()
    try:
        with _client() as client:
            resp = client.get(
                "http://export.arxiv.org/api/query",
                params={"search_query": f"all:{query}", "max_results": limit},
            )
            resp.raise_for_status()
            text = resp.text
    except Exception as exc:
        return {"source": "arXiv", "ok": False, "error": str(exc)[:200], "items": []}

    import re

    entries = re.findall(r"<entry>(.*?)</entry>", text, re.S)
    items = []
    for entry in entries[:limit]:
        title = re.search(r"<title>(.*?)</title>", entry, re.S)
        link = re.search(r"<id>(.*?)</id>", entry, re.S)
        published = re.search(r"<published>(\d{4})", entry)
        items.append(
            {
                "title": " ".join(title.group(1).split()) if title else None,
                "url": link.group(1).strip() if link else None,
                "year": int(published.group(1)) if published else None,
            }
        )
    return {
        "source": "arXiv",
        "ok": True,
        "items": items,
        "seconds": round(time.time() - started, 2),
    }


if __name__ == "__main__":
    import json

    print(json.dumps(openalex_works("honey bee pesticide toxicity", 3), indent=2)[:900])
    print(json.dumps(europepmc_search("honey bee acute contact toxicity LD50", 3), indent=2)[:900])
    print(json.dumps(pubchem_compound(5564), indent=2))
    print(json.dumps(arxiv_search("active learning molecular property", 2), indent=2))
