"""Stage the deployable files and push them to the Hugging Face Space.

    HF_TOKEN=hf_... python deploy/push_space.py [--repo marketpilot/beeguard-lab]

Only what the running app reads is uploaded: the lab package, its data and
derived artifacts, the agent configs, and the built web app.
"""
from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from huggingface_hub import HfApi  # noqa: E402

from stage import README, stage  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="marketpilot/beeguard-lab")
    parser.add_argument("--dry", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token and not args.dry:
        raise SystemExit("HF_TOKEN is not set")

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        stage(out)
        files = [p for p in out.rglob("*") if p.is_file()]
        size = sum(p.stat().st_size for p in files)
        print(f"staged {len(files)} files, {size / 1e6:.1f} MB")
        if args.dry:
            for p in sorted(files)[:400]:
                print(" ", p.relative_to(out))
            return
        api = HfApi(token=token)
        api.create_repo(args.repo, repo_type="space", space_sdk="docker", exist_ok=True)
        info = api.upload_folder(
            repo_id=args.repo,
            repo_type="space",
            folder_path=str(out),
            commit_message="Deploy BeeGuard Lab",
            delete_patterns=["lab/**", "apps/**", "agents/**"],
        )
        print("pushed:", info)
        owner, name = args.repo.split("/")
        print(f"space: https://huggingface.co/spaces/{args.repo}")
        print(f"app:   https://{owner}-{name}.hf.space")


if __name__ == "__main__":
    main()
