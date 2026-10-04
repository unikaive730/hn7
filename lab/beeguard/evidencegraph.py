"""Literature graph around the molecules the lab has to find.

For each hidden answer at a cutoff year (insecticides first recorded after the
cutoff and labelled bee-safe), this asks a literature index three questions:

  1. how many works name the molecule in title or abstract, per year
  2. how many of those also name bees or pollinators, per year
  3. which of those works are cited most, and which are the earliest

It asks the same of four background concepts, then links papers to every
molecule and concept whose name appears in the paper's own title or abstract.
The point is a dated comparison: how much was written about each molecule by
the cutoff year, against how far up the lab ranked it using only data from
that time.

Index: OpenAlex first. OpenAlex now meters requests without an API key per IP
address and per day; when it answers 429 the build stops calling it at once
and uses Europe PMC instead, and the saved file says which index was used and
why. Set OPENALEX_API_KEY to use a key.

Results are saved to lab/data/derived/evidence_graph.json with the fetch time
and request counts. A rebuild that comes back incomplete never replaces a
complete file. Rebuild with:

    PYTHONUTF8=1 PYTHONPATH=. lab/.venv/Scripts/python.exe -m lab.beeguard.evidencegraph --refresh
"""
from __future__ import annotations

import html
import json
import os
import re
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

from . import sources

DATA = Path(__file__).resolve().parents[1] / "data"
DERIVED = DATA / "derived"
OPENALEX = "https://api.openalex.org/works"
EUROPEPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
PUBCHEM_SYNONYMS = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/synonyms/JSON"
MAILTO = "ceo@marketpilot.it"
MAX_REQUESTS = 80
PAUSE = 0.12
TOP_WORKS = 5
EPMC_PAGE = 1000
EPMC_MAX_PAGES = 7
BEE_WORDS = "bee OR bees OR honeybee OR honeybees OR apis OR pollinator OR pollinators"
BEE_PATTERN = r"\bbees?\b|honey ?bees?|\bapis\b|pollinat"

# Background concepts. Each index gets its own query string, written to mean
# the same thing; `pattern` decides whether a paper's text mentions it.
CONCEPTS: list[dict[str, str]] = [
    {
        "id": "c:neonicotinoid",
        "label": "Neonicotinoids",
        "openalex": "neonicotinoid OR neonicotinoids",
        "europepmc": "neonicotinoid OR neonicotinoids",
        "pattern": r"neonicotinoid",
    },
    {
        "id": "c:pollinator",
        "label": "Pollinator safety",
        "openalex": 'pollinator AND (safety OR "risk assessment")',
        "europepmc": ["pollinator OR pollinators", 'safety OR "risk assessment"'],
        "pattern": r"pollinat",
    },
    {
        "id": "c:bee_acute",
        "label": "Honey bee acute toxicity",
        "openalex": '("honey bee" OR honeybee OR "Apis mellifera") AND ("acute toxicity" OR LD50)',
        "europepmc": ['"honey bee" OR honeybee OR "Apis mellifera"', '"acute toxicity" OR LD50'],
        "pattern": r"honey ?bees?|apis mellifera",
    },
    {
        "id": "c:selectivity",
        "label": "Insecticide selectivity",
        "openalex": "insecticide AND selectivity",
        "europepmc": ["insecticide OR insecticides", "selectivity"],
        "pattern": r"selectiv",
    },
]

_COMMON_NAME = re.compile(r"^[A-Za-z][a-z]+(?:-[a-z]+)?$")


class RateLimited(Exception):
    pass


class _Budget:
    """Counts requests per service and stops a service at its first 429."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.counts: dict[str, int] = {}
        self.halted: dict[str, str] = {}
        self.errors: list[str] = []

    @property
    def used(self) -> int:
        return sum(self.counts.values())

    def get(self, client, service: str, url: str, params: dict | None = None) -> dict | None:
        if service in self.halted:
            return None
        if self.used >= self.limit:
            self.errors.append(f"request limit {self.limit} reached before a {service} call")
            return None
        self.counts[service] = self.counts.get(service, 0) + 1
        try:
            resp = client.get(url, params=params)
            if resp.status_code == 429:
                reason = resp.text[:220]
                self.halted[service] = reason
                self.errors.append(f"{service}: 429 {reason}")
                return None
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # recorded and shown, never replaced with a guess
            self.errors.append(f"{service}: {str(exc)[:160]}")
            return None
        finally:
            time.sleep(PAUSE)


# ---------------------------------------------------------------- molecules


def hidden_answers(cutoff_year: int) -> pd.DataFrame:
    """Insecticides first recorded after the cutoff and labelled bee-safe."""
    full = pd.read_csv(DATA / "dataset_final.csv")
    full = full[full["year"].notna()]
    mask = (full["year"] > cutoff_year) & (full["insecticide"] == 1) & (full["label"] == 0)
    return full[mask].sort_values("year").reset_index(drop=True)


def _clean_name(name: str) -> str:
    return re.sub(r"\s*\(Ref:[^)]*\)\s*", "", str(name)).strip()


def _search_term(client, budget: _Budget, cid: int, dataset_name: str) -> dict:
    """Use the dataset name when it is already a common name, else ask PubChem.

    Four of the thirteen names in ApisTox are IUPAC-style descriptions, which
    no paper uses. PubChem's synonym list carries the common name for each.
    """
    cleaned = _clean_name(dataset_name)
    if _COMMON_NAME.match(cleaned):
        return {"term": cleaned, "from": "ApisTox name"}
    data = budget.get(client, "PubChem", PUBCHEM_SYNONYMS.format(cid=cid))
    synonyms = []
    if data:
        synonyms = data.get("InformationList", {}).get("Information", [{}])[0].get("Synonym", [])
    for synonym in synonyms:
        if _COMMON_NAME.match(synonym):
            return {"term": synonym[0].upper() + synonym[1:], "from": "PubChem synonym"}
    return {"term": cleaned, "from": "ApisTox name (no PubChem common name)"}


def _name_pattern(term: str) -> str:
    """Match a name in running text, allowing "tau - fluvalinate" style spacing."""
    parts = [re.escape(p) for p in re.split(r"[\s-]+", term.strip()) if p]
    return r"\b" + r"[\s-]*".join(parts)


def _learned_ranks(cutoff_year: int) -> dict:
    """Where each pool molecule sits in the lab's own ordering at this cutoff."""
    from .engine import get_lab

    lab = get_lab(cutoff_year)
    order = lab.order("model", len(lab.pool))
    ranks = {}
    for position, idx in enumerate(order, start=1):
        cid = int(lab.pool.loc[idx, "CID"])
        ranks[cid] = {
            "rank": position,
            "safe_score": round(float(lab.safe_score[idx]), 4),
            "scaffold_seen": bool(lab.seen_scaffold[idx]),
        }
    return {"pool_size": int(len(lab.pool)), "train_size": int(len(lab.train)), "ranks": ranks}


def _years_of(works_years: list[int]) -> dict[int, int]:
    out: dict[int, int] = {}
    for year in works_years:
        out[year] = out.get(year, 0) + 1
    return dict(sorted(out.items()))


# ----------------------------------------------------------------- OpenAlex


class OpenAlexIndex:
    name = "OpenAlex"
    url = "https://openalex.org"
    match_field = "title_and_abstract"

    def __init__(self, client, budget: _Budget, cutoff: int) -> None:
        self.client, self.budget, self.cutoff = client, budget, cutoff
        self.key = os.environ.get("OPENALEX_API_KEY")

    def _params(self, extra: dict) -> dict:
        params = {"mailto": MAILTO, **extra}
        if self.key:
            params["api_key"] = self.key
        return params

    def available(self) -> bool:
        data = self.budget.get(
            self.client, self.name, OPENALEX, self._params({"filter": "title_and_abstract.search:apis", "per-page": 1})
        )
        return data is not None

    def molecule_query(self, term: str) -> str:
        return f'"{term.lower()}"' if "-" in term else term.lower()

    def bee_query(self, query: str) -> str:
        return f"{query} AND ({BEE_WORDS})"

    def concept_query(self, concept: dict) -> str:
        return concept["openalex"]

    def _years(self, query: str) -> dict | None:
        data = self.budget.get(
            self.client,
            self.name,
            OPENALEX,
            self._params({"filter": f"title_and_abstract.search:{query}", "group_by": "publication_year"}),
        )
        if data is None:
            return None
        by_year = {}
        for group in data.get("group_by", []):
            try:
                by_year[int(group["key"])] = int(group["count"])
            except (TypeError, ValueError):
                continue
        return {"total": data.get("meta", {}).get("count"), "by_year": dict(sorted(by_year.items()))}

    def _works(self, query: str, limit: int, until: int | None = None) -> list[dict] | None:
        filters = f"title_and_abstract.search:{query}"
        if until is not None:
            filters += f",publication_year:<{until + 1}"
        data = self.budget.get(
            self.client,
            self.name,
            OPENALEX,
            self._params(
                {
                    "filter": filters,
                    "sort": "publication_year:asc" if until is not None else "cited_by_count:desc",
                    "per-page": limit,
                    "select": "id,doi,display_name,publication_year,cited_by_count,"
                    "primary_location,abstract_inverted_index,authorships",
                }
            ),
        )
        if data is None:
            return None
        works = []
        for work in data.get("results", []):
            source = (work.get("primary_location") or {}).get("source") or {}
            authors = [
                (a.get("author") or {}).get("display_name")
                for a in (work.get("authorships") or [])
                if (a.get("author") or {}).get("display_name")
            ]
            inverted = work.get("abstract_inverted_index") or {}
            slots = {p: w for w, ps in inverted.items() for p in ps}
            abstract = " ".join(slots[i] for i in sorted(slots))
            works.append(
                {
                    "pid": (work.get("id") or "").rsplit("/", 1)[-1],
                    "title": work.get("display_name"),
                    "year": work.get("publication_year"),
                    "cited_by": work.get("cited_by_count"),
                    "doi": (work.get("doi") or "").replace("https://doi.org/", "") or None,
                    "venue": source.get("display_name"),
                    "first_author": authors[0] if authors else None,
                    "_text": f"{work.get('display_name') or ''} {abstract}",
                }
            )
        return works

    def series(self, query: str, top: int, early: bool) -> dict | None:
        years = self._years(query)
        if years is None:
            return None
        out = {**years, "top": self._works(query, top) or []}
        before = sum(n for y, n in years["by_year"].items() if y <= self.cutoff)
        out["early"] = (self._works(query, 5, until=self.cutoff) or []) if early and before else []
        return out

    def counts(self, query: str) -> dict | None:
        return self._years(query)

    def fill_text(self, papers: dict) -> None:
        return None  # abstracts came with the works

    def method(self) -> str:
        return (
            "OpenAlex works API, filter title_and_abstract.search, grouped by publication_year; "
            "most cited and earliest works from the same filter."
        )


# --------------------------------------------------------------- Europe PMC


def _ta(expr: str) -> str:
    return f"(TITLE:({expr}) OR ABSTRACT:({expr}))"


class EuropePMCIndex:
    name = "Europe PMC"
    url = "https://europepmc.org"
    match_field = "TITLE or ABSTRACT"

    def __init__(self, client, budget: _Budget, cutoff: int) -> None:
        self.client, self.budget, self.cutoff = client, budget, cutoff

    def molecule_query(self, term: str) -> str:
        t = term.lower()
        if "-" in t:
            return _ta(f'"{t}" OR "{t.replace("-", " ")}"')
        return _ta(t)

    def bee_query(self, query: str) -> str:
        return f"{query} AND {_ta(BEE_WORDS)}"

    def concept_query(self, concept: dict) -> str:
        spec = concept["europepmc"]
        if isinstance(spec, str):
            return _ta(spec)
        return " AND ".join(_ta(part) for part in spec)

    def _all(self, query: str) -> dict | None:
        """Every matching record (title, year, citations), paged with a cursor."""
        cursor, rows, total = "*", [], None
        for _ in range(EPMC_MAX_PAGES):
            data = self.budget.get(
                self.client,
                self.name,
                EUROPEPMC,
                {
                    "query": query,
                    "format": "json",
                    "resultType": "lite",
                    "pageSize": EPMC_PAGE,
                    "cursorMark": cursor,
                },
            )
            if data is None:
                return None
            total = data.get("hitCount")
            rows += data.get("resultList", {}).get("result", [])
            nxt = data.get("nextCursorMark")
            if not nxt or nxt == cursor or len(rows) >= (total or 0):
                break
            cursor = nxt
        works = []
        for r in rows:
            try:
                year = int(r.get("pubYear"))
            except (TypeError, ValueError):
                year = None
            authors = (r.get("authorString") or "").split(",")
            works.append(
                {
                    "pid": f"{r.get('source')}-{r.get('id')}",
                    "title": html.unescape(re.sub(r"<[^>]+>", "", r.get("title") or "")).strip().rstrip("."),
                    "year": year,
                    "cited_by": r.get("citedByCount"),
                    "doi": r.get("doi"),
                    "venue": r.get("journalTitle"),
                    "first_author": authors[0].strip() or None,
                    "_src": r.get("source"),
                    "_extid": r.get("id"),
                    "_text": "",
                }
            )
        return {
            "total": total,
            "retrieved": len(works),
            "by_year": _years_of([w["year"] for w in works if w["year"]]),
            "works": works,
        }

    def series(self, query: str, top: int, early: bool) -> dict | None:
        got = self._all(query)
        if got is None:
            return None
        works = got.pop("works")
        cited = sorted(works, key=lambda w: (-(w["cited_by"] or 0), w["year"] or 0))[:top]
        dated = sorted(
            (w for w in works if w["year"] and w["year"] <= self.cutoff), key=lambda w: w["year"]
        )[:5]
        return {**got, "top": cited, "early": dated if early else []}

    def counts(self, query: str) -> dict | None:
        got = self._all(query)
        if got is None:
            return None
        got.pop("works")
        return got

    def fill_text(self, papers: dict) -> None:
        """One batched request per 25 papers for the abstracts."""
        pending = [p for p in papers.values() if p.get("_src") and p.get("_extid")]
        for start in range(0, len(pending), 25):
            chunk = pending[start : start + 25]
            query = " OR ".join(f"(EXT_ID:{p['_extid']} AND SRC:{p['_src']})" for p in chunk)
            data = self.budget.get(
                self.client,
                self.name,
                EUROPEPMC,
                {"query": query, "format": "json", "resultType": "core", "pageSize": 100},
            )
            if data is None:
                continue
            found = {
                f"{r.get('source')}-{r.get('id')}": re.sub(r"<[^>]+>", " ", r.get("abstractText") or "")
                for r in data.get("resultList", {}).get("result", [])
            }
            for p in chunk:
                p["_text"] = f"{p['title']} {html.unescape(found.get(p['pid'], ''))}"

    def method(self) -> str:
        return (
            "Europe PMC REST search on TITLE and ABSTRACT fields; every matching record was paged "
            "in and counted by publication year, then sorted for the most cited and earliest."
        )


# -------------------------------------------------------------------- build


def _split(by_year: dict, cutoff: int) -> tuple[int, int]:
    before = sum(n for y, n in by_year.items() if int(y) <= cutoff)
    after = sum(n for y, n in by_year.items() if int(y) > cutoff)
    return before, after


def build(cutoff_year: int = 2000) -> dict[str, Any]:
    started = time.time()
    budget = _Budget(MAX_REQUESTS)
    answers = hidden_answers(cutoff_year)
    learned = _learned_ranks(cutoff_year)

    molecules: list[dict] = []
    concepts: list[dict] = []
    papers: dict[str, dict] = {}
    edges: list[dict] = []

    def add(work: dict, found_by: str) -> str:
        key = "p:" + work["pid"]
        if key not in papers:
            papers[key] = {**work, "id": key, "found_by": []}
        if found_by not in papers[key]["found_by"]:
            papers[key]["found_by"].append(found_by)
        return key

    with sources._client() as client:
        index: Any = OpenAlexIndex(client, budget, cutoff_year)
        fallback_reason = None
        if not index.available():
            fallback_reason = budget.halted.get("OpenAlex") or (budget.errors[-1] if budget.errors else "no answer")
            index = EuropePMCIndex(client, budget, cutoff_year)

        for _, row in answers.iterrows():
            cid = int(row["CID"])
            term = _search_term(client, budget, cid, row["name"])
            query = index.molecule_query(term["term"])
            node_id = f"m:{cid}"
            main = index.series(query, TOP_WORKS, early=True)
            bee = index.counts(index.bee_query(query))
            top_ids = [add(w, node_id) for w in (main or {}).get("top", [])]
            early_ids = [add(w, node_id) for w in (main or {}).get("early", [])]

            rank = learned["ranks"].get(cid, {})
            entry: dict[str, Any] = {
                "id": node_id,
                "cid": cid,
                "dataset_name": str(row["name"]),
                "label": term["term"],
                "term_from": term["from"],
                "query": query,
                "apistox_year": int(row["year"]),
                "rank": rank.get("rank"),
                "safe_score": rank.get("safe_score"),
                "scaffold_seen": rank.get("scaffold_seen"),
                "ok": main is not None and bee is not None,
                "top_paper_ids": top_ids,
                "early_paper_ids": early_ids,
            }
            for key, got in (("all", main), ("bee", bee)):
                if got is None:
                    entry[key] = None
                    continue
                before, after = _split(got["by_year"], cutoff_year)
                entry[key] = {
                    "total": got["total"],
                    "retrieved": got.get("retrieved", got["total"]),
                    "by_year": got["by_year"],
                    "before": before,
                    "after": after,
                    "first_year": min(got["by_year"]) if got["by_year"] else None,
                }
            molecules.append(entry)

        for concept in CONCEPTS:
            query = index.concept_query(concept)
            got = index.series(query, 4, early=False)
            entry = {
                "id": concept["id"],
                "label": concept["label"],
                "pattern": concept["pattern"],
                "query": query,
                "ok": got is not None,
                "top_paper_ids": [add(w, concept["id"]) for w in (got or {}).get("top", [])],
            }
            if got is not None:
                before, after = _split(got["by_year"], cutoff_year)
                entry.update(
                    total=got["total"],
                    retrieved=got.get("retrieved", got["total"]),
                    by_year=got["by_year"],
                    before=before,
                    after=after,
                )
            concepts.append(entry)

        index.fill_text(papers)

    # Edges: the query that returned a paper, plus every other molecule or
    # concept whose name appears in the paper's own title or abstract.
    patterns = [(m["id"], re.compile(_name_pattern(m["label"]), re.I)) for m in molecules]
    patterns += [(c["id"], re.compile(c["pattern"], re.I)) for c in CONCEPTS]
    bee_re = re.compile(BEE_PATTERN, re.I)
    for key, paper in papers.items():
        text = paper.get("_text") or paper.get("title") or ""
        title = paper.get("title") or ""
        for private in [k for k in paper if k.startswith("_")]:
            paper.pop(private)
        paper["mentions_bees"] = bool(bee_re.search(text))
        paper["title_mentions"] = [nid for nid, pattern in patterns if pattern.search(title)]
        paper["mentions"] = []
        for node_id, pattern in patterns:
            hit = bool(pattern.search(text))
            if hit:
                paper["mentions"].append(node_id)
            if node_id in paper["found_by"]:
                edges.append({"source": key, "target": node_id, "kind": "query", "text_match": hit})
            elif hit:
                edges.append({"source": key, "target": node_id, "kind": "text", "text_match": True})
        paper["after_cutoff"] = (paper.get("year") or 0) > cutoff_year

    service_notes = {
        "OpenAlex": "availability check" if fallback_reason else "works per year, most cited and earliest works, abstracts",
        "Europe PMC": "records per year, most cited and earliest records, abstracts",
        "PubChem": "common names for molecules listed under IUPAC-style names",
    }
    urls = {"OpenAlex": OpenAlexIndex.url, "Europe PMC": EuropePMCIndex.url, "PubChem": "https://pubchem.ncbi.nlm.nih.gov"}
    return {
        "cutoff_year": cutoff_year,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "build_seconds": round(time.time() - started, 1),
        "literature": {
            "name": index.name,
            "url": index.url,
            "fallback_from": "OpenAlex" if fallback_reason else None,
            "fallback_reason": fallback_reason[:200] if fallback_reason else None,
        },
        "sources": [
            {"name": name, "url": urls[name], "requests": n, "used_for": service_notes[name]}
            for name, n in budget.counts.items()
        ],
        "method": index.method(),
        "match_field": index.match_field,
        "bee_terms": f"({BEE_WORDS})",
        "errors": budget.errors,
        "lab": {"pool_size": learned["pool_size"], "train_size": learned["train_size"]},
        "summary": _summary(molecules),
        "molecules": molecules,
        "concepts": concepts,
        "papers": list(papers.values()),
        "edges": edges,
    }


def _summary(molecules: list[dict]) -> dict:
    ok = [m for m in molecules if m["all"] is not None and m["bee"] is not None]
    before = sum(m["all"]["before"] for m in ok)
    after = sum(m["all"]["after"] for m in ok)
    first_bee = sorted(m["bee"]["first_year"] for m in ok if m["bee"]["first_year"])
    ranks = [m["rank"] for m in ok if m["rank"]]
    return {
        "molecules": len(molecules),
        "molecules_with_data": len(ok),
        "papers_before": before,
        "papers_after": after,
        "share_after": round(after / (before + after), 3) if before + after else None,
        "bee_papers_before": sum(m["bee"]["before"] for m in ok),
        "bee_papers_after": sum(m["bee"]["after"] for m in ok),
        "no_bee_paper_by_cutoff": sum(1 for m in ok if m["bee"]["before"] == 0),
        "no_paper_by_cutoff": sum(1 for m in ok if m["all"]["before"] == 0),
        "median_first_bee_year": first_bee[len(first_bee) // 2] if first_bee else None,
        "worst_rank": max(ranks) if ranks else None,
        "median_rank": sorted(ranks)[len(ranks) // 2] if ranks else None,
    }


def _complete(data: dict) -> bool:
    s = data["summary"]
    return bool(data["papers"]) and s["molecules_with_data"] == s["molecules"] and all(
        c.get("ok") for c in data["concepts"]
    )


# -------------------------------------------------------------------- cache


def cache_path(cutoff_year: int) -> Path:
    name = "evidence_graph.json" if cutoff_year == 2000 else f"evidence_graph_{cutoff_year}.json"
    return DERIVED / name


@lru_cache(maxsize=8)
def _load(cutoff_year: int, stamp: float) -> dict:
    return json.loads(cache_path(cutoff_year).read_text(encoding="utf-8"))


def graph(cutoff_year: int = 2000, refresh: bool = False) -> dict:
    """Serve the saved graph; query the live index only when asked or missing.

    An incomplete rebuild (rate limit, network error) is returned with its
    errors but does not overwrite a complete saved file.
    """
    path = cache_path(cutoff_year)
    if refresh or not path.exists():
        data = build(cutoff_year)
        if _complete(data):
            DERIVED.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        elif path.exists():
            kept = dict(_load(cutoff_year, path.stat().st_mtime))
            kept["refresh_failed"] = {"at": data["fetched_at"], "errors": data["errors"][:5]}
            return kept
        else:
            return data
    return _load(cutoff_year, path.stat().st_mtime)


def timeline(cutoff_year: int = 2000) -> dict:
    """Records per year for each concept, and for the molecule set summed."""
    data = graph(cutoff_year)
    years: dict[int, dict] = {}
    for concept in data["concepts"]:
        for year, count in (concept.get("by_year") or {}).items():
            years.setdefault(int(year), {})[concept["id"]] = count
    for molecule in data["molecules"]:
        for key, series in (("all", "molecules"), ("bee", "molecules_bee")):
            for year, count in ((molecule.get(key) or {}).get("by_year") or {}).items():
                row = years.setdefault(int(year), {})
                row[series] = row.get(series, 0) + count
    return {
        "cutoff_year": data["cutoff_year"],
        "fetched_at": data["fetched_at"],
        "source": data.get("literature", {}).get("name", "OpenAlex"),
        "match_field": data["match_field"],
        "series": [
            *({"id": c["id"], "label": c["label"], "query": c["query"]} for c in data["concepts"]),
            {"id": "molecules", "label": "The hidden answers, summed", "query": "one query per molecule"},
            {"id": "molecules_bee", "label": "Hidden answers with bee terms", "query": data["bee_terms"]},
        ],
        "rows": [{"year": year, **values} for year, values in sorted(years.items())],
    }


# --------------------------------------------------------------- structures


@lru_cache(maxsize=64)
def structure_svg(cid: int) -> str | None:
    """A 2D drawing of one dataset molecule, coloured for the dark page."""
    from rdkit import Chem
    from rdkit.Chem import rdDepictor
    from rdkit.Chem.Draw import rdMolDraw2D

    full = pd.read_csv(DATA / "dataset_final.csv", usecols=["CID", "SMILES"])
    match = full[full["CID"] == cid]
    if match.empty:
        return None
    mol = Chem.MolFromSmiles(match.iloc[0]["SMILES"])
    if mol is None:
        return None
    rdDepictor.Compute2DCoords(mol)
    drawer = rdMolDraw2D.MolDraw2DSVG(420, 300)
    rdMolDraw2D.SetDarkMode(drawer)
    options = drawer.drawOptions()
    options.setBackgroundColour((0, 0, 0, 0))
    options.bondLineWidth = 1.6
    options.minFontSize = 11
    options.padding = 0.06
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return re.sub(r"<\?xml[^>]*\?>\s*", "", drawer.GetDrawingText())


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--cutoff", type=int, default=2000)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    result = graph(args.cutoff, refresh=args.refresh)
    keys = ("fetched_at", "build_seconds", "literature", "sources", "errors", "summary", "refresh_failed")
    print(json.dumps({k: result.get(k) for k in keys}, indent=2))
    for m in result["molecules"]:
        a, b = m["all"] or {}, m["bee"] or {}
        print(
            f"#{m['rank']:>3}  {m['label']:<22} apistox {m['apistox_year']}  "
            f"all {a.get('before')}/{a.get('after')} (got {a.get('retrieved')} of {a.get('total')})  "
            f"bee {b.get('before')}/{b.get('after')}  first bee {b.get('first_year')}"
        )
    print(len(result["papers"]), "papers", len(result["edges"]), "edges")
