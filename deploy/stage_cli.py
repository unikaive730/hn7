"""python deploy/stage_cli.py <out_dir> : stage the app for a server deploy."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stage import stage  # noqa: E402

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
stage(out)
files = [p for p in out.rglob("*") if p.is_file()]
print(f"staged {len(files)} files, {sum(p.stat().st_size for p in files) / 1e6:.1f} MB")
