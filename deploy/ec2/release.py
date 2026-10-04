"""Ship a verified snapshot to the existing demo server and keep its backup.

Run from the repository: python deploy/ec2/release.py --deploy
Without --deploy this prepares and verifies the archive locally only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deploy'))
from stage import stage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deploy', action='store_true')
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    staging = Path(tempfile.mkdtemp(prefix=f'beeguard-{stamp}-'))
    stage(staging)
    manifest = {
        'created_at': stamp,
        'files': {
            p.relative_to(staging).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(staging.rglob('*')) if p.is_file()
        },
    }
    (staging / 'release.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    python = ROOT / 'lab' / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    env = {**os.environ, 'PYTHONUTF8': '1', 'WEB_DIST': str(staging / 'apps/web/dist')}
    subprocess.run([str(python), str(staging / 'verify_release.py')], cwd=staging, env=env, check=True)
    archive = staging.with_suffix('.tar.gz')
    with tarfile.open(archive, 'w:gz') as tar:
        # Omit bytecode produced by smoke checks; sources are hashed above.
        for p in staging.rglob('*'):
            if p.is_file() and '__pycache__' not in p.parts:
                tar.add(p, arcname=p.relative_to(staging).as_posix())
    print(f'Verified archive: {archive}', flush=True)
    if not args.deploy:
        return

    host = os.environ.get('BEEGUARD_HOST', 'ubuntu@13.125.16.61')
    key = os.environ.get('BEEGUARD_KEY', str(Path.home() / '.ssh/beeguard-demo.pem'))
    ssh = ['ssh', '-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new', host]
    remote = f'/opt/beeguard/releases/{stamp}'
    backup = f'/opt/beeguard/releases/backup-{stamp}'
    failed = f'/opt/beeguard/releases/failed-{stamp}'
    # All mutation targets are fixed beneath this app's deployment root.
    def run(command):
        subprocess.run([*ssh, command], check=True)

    run(f'mkdir -p {shlex.quote(remote)}')
    with archive.open('rb') as content:
        subprocess.run([*ssh, f'tar -xzf - -C {shlex.quote(remote)}'], stdin=content, check=True)
    run(f'cd {shlex.quote(remote)} && PYTHONUTF8=1 WEB_DIST={shlex.quote(remote + "/apps/web/dist")} /opt/beeguard/venv/bin/python verify_release.py')
    switched = False
    try:
        switched = True
        run(f'test -d /opt/beeguard/app && test ! -e {shlex.quote(backup)} && mv /opt/beeguard/app {shlex.quote(backup)} && mv {shlex.quote(remote)} /opt/beeguard/app')
        run('sudo systemctl restart beeguard')
        deadline = time.monotonic() + 90
        while True:
            try:
                with urllib.request.urlopen('https://beeguard.marketpilot.it/api/health', timeout=10) as response:
                    if response.status == 200 and json.load(response).get('ok'):
                        break
                    raise RuntimeError('Public health endpoint is not ready')
            except Exception:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(2)
        for path in ('/', '/api/headline', '/api/agents/topology', '/api/external', '/api/candidates', '/api/ledger?live=false'):
            with urllib.request.urlopen(f'https://beeguard.marketpilot.it{path}', timeout=30) as response:
                if response.status != 200:
                    raise RuntimeError(f'Public smoke failed: {path}')
        print(f'Live: https://beeguard.marketpilot.it ; backup: {backup}', flush=True)
    except Exception:
        if switched:
            run(f'if test -d {shlex.quote(backup)}; then if test -d /opt/beeguard/app; then mv /opt/beeguard/app {shlex.quote(failed)}; fi; mv {shlex.quote(backup)} /opt/beeguard/app && sudo systemctl restart beeguard; fi')
            print('Rolled back to the previous app; failed release preserved.', flush=True)
        raise


if __name__ == '__main__':
    main()
