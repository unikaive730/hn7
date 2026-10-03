"""Download the ApisTox dataset and record a checksum.

The data is CC-BY-NC-4.0, so it is never committed to this MIT-licensed
repository. Run this script once before anything else.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import httpx

RAW = "https://raw.githubusercontent.com/j-adamczyk/ApisTox_dataset/master/outputs"
FILES = {
    "dataset_final.csv": f"{RAW}/dataset_final.csv",
    "time_train.csv": f"{RAW}/splits/time_train.csv",
    "time_test.csv": f"{RAW}/splits/time_test.csv",
    "maxmin_train.csv": f"{RAW}/splits/maxmin_train.csv",
    "maxmin_test.csv": f"{RAW}/splits/maxmin_test.csv",
}
DATA = Path(__file__).resolve().parents[1] / "data"


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        for name, url in FILES.items():
            out = DATA / name
            resp = client.get(url)
            resp.raise_for_status()
            out.write_bytes(resp.content)
            manifest[name] = {
                "url": url,
                "bytes": len(resp.content),
                "sha256": hashlib.sha256(resp.content).hexdigest(),
            }
            print(f"{name:20s} {len(resp.content):>8,} bytes")
    (DATA / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nmanifest written to {DATA / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
