"""Pull two extra datasets from ChEMBL and record exactly what came back.

1. Bee records: every activity ChEMBL files under the organism-level targets
   Apis mellifera (CHEMBL612665) and Bombus terrestris (CHEMBL2367044).
   ChEMBL holds very few of these; the manifest records the real count.
2. Pest records: every activity filed under organism-level targets for crop
   pest insects that return data. Mites are left out on purpose.

Source: ChEMBL web services, https://www.ebi.ac.uk/chembl/api/data/
Licence: CC BY-SA 3.0. Cite ChEMBL (Zdrazil et al., NAR 2024) when reusing.

Raw records are written as returned. Labelling, de-duplication against
ApisTox and scoring happen in lab/beeguard/external.py so they can be re-run
without hitting the network again.

    PYTHONUTF8=1 lab/.venv/Scripts/python.exe lab/scripts/fetch_chembl.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

API = "https://www.ebi.ac.uk/chembl/api/data/activity.json"
DATA = Path(__file__).resolve().parents[1] / "data"
PAGE = 1000
MAX_PER_TARGET = 4000  # hard cap so one target cannot run away
PAUSE_SECONDS = 0.6  # between requests, to stay polite
HEADERS = {"User-Agent": "hn7-beeguard (Hack-Nation 7 submission; ceo@marketpilot.it)"}

BEE_TARGETS = {
    "CHEMBL612665": "Apis mellifera",
    "CHEMBL2367044": "Bombus terrestris",
}
PEST_TARGETS = {
    "CHEMBL612683": "Myzus persicae",
    "CHEMBL613807": "Aphis gossypii",
    "CHEMBL613806": "Aphis craccivora",
    "CHEMBL614677": "Plutella xylostella",
    "CHEMBL613465": "Spodoptera frugiperda",
    "CHEMBL613146": "Spodoptera litura",
    "CHEMBL613321": "Spodoptera exigua",
    "CHEMBL1075348": "Helicoverpa armigera",
    "CHEMBL2366822": "Mythimna separata",
    "CHEMBL612974": "Nilaparvata lugens",
    "CHEMBL613910": "Bemisia tabaci",
}
FIELDS = [
    "activity_id",
    "target_chembl_id",
    "target_organism",
    "molecule_chembl_id",
    "molecule_pref_name",
    "canonical_smiles",
    "standard_type",
    "standard_relation",
    "standard_value",
    "standard_units",
    "activity_comment",
    "data_validity_comment",
    "assay_chembl_id",
    "assay_type",
    "assay_description",
    "document_chembl_id",
    "document_year",
]


def fetch_target(client: httpx.Client, target: str, log: list[dict]) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    total = None
    while offset < MAX_PER_TARGET:
        params = {
            "target_chembl_id": target,
            "limit": PAGE,
            "offset": offset,
            "only": ",".join(FIELDS),
        }
        for attempt in range(4):
            try:
                resp = client.get(API, params=params)
                resp.raise_for_status()
                break
            except httpx.HTTPError as exc:
                if attempt == 3:
                    raise
                print(f"  retry {attempt + 1} for {target} offset {offset}: {exc}")
                time.sleep(2 * (attempt + 1))
        data = resp.json()
        total = data["page_meta"]["total_count"]
        batch = data.get("activities", [])
        rows.extend({k: a.get(k) for k in FIELDS} for a in batch)
        offset += PAGE
        time.sleep(PAUSE_SECONDS)
        if not batch or offset >= total:
            break
    log.append(
        {
            "target_chembl_id": target,
            "records_available": total,
            "records_fetched": len(rows),
            "capped": bool(total and total > MAX_PER_TARGET),
        }
    )
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    started = time.time()
    DATA.mkdir(parents=True, exist_ok=True)
    manifest: dict = {
        "source": "ChEMBL web services",
        "endpoint": API,
        "licence": "CC BY-SA 3.0",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "page_size": PAGE,
        "max_per_target": MAX_PER_TARGET,
        "pause_seconds": PAUSE_SECONDS,
        "files": {},
    }
    with httpx.Client(timeout=httpx.Timeout(90.0, connect=10.0), headers=HEADERS) as client:
        for name, targets, query in (
            ("chembl_apis.csv", BEE_TARGETS, "activity?target_chembl_id=<organism target>, bees"),
            ("chembl_pests.csv", PEST_TARGETS, "activity?target_chembl_id=<organism target>, pests"),
        ):
            rows: list[dict] = []
            log: list[dict] = []
            for target, organism in targets.items():
                print(f"{name}: {organism} ({target}) ...", flush=True)
                got = fetch_target(client, target, log)
                log[-1]["organism"] = organism
                print(f"  {len(got)} of {log[-1]['records_available']}", flush=True)
                rows.extend(got)
            path = DATA / name
            write_csv(path, rows)
            manifest["files"][name] = {
                "query": query,
                "targets": log,
                "records": len(rows),
                "molecules": len({r["molecule_chembl_id"] for r in rows}),
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
    manifest["seconds"] = round(time.time() - started, 1)
    (DATA / "chembl_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in manifest.items() if k != "files"}, indent=2))
    for name, info in manifest["files"].items():
        print(f"{name}: {info['records']} records, {info['molecules']} molecules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
