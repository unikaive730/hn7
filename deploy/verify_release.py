"""Offline smoke checks for a staged release, using its own source tree."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi.testclient import TestClient
from lab.beeguard.api import app


def verify():
    client = TestClient(app)
    paths = [
        '/', '/api/health', '/api/facts', '/api/headline',
        '/api/curve?strategy=insecticide_only&budget=201', '/api/compare?budget=201',
        '/api/agents/topology', '/api/agents/runs', '/api/hidden', '/api/space',
        '/api/rigor', '/api/learning?budget=30&batch=10',
        '/api/evidence/graph', '/api/evidence/timeline', '/api/external',
        '/api/candidates', '/api/ledger?live=false', '/api/ledger/method', '/api/ledger/datacard',
    ]
    for path in paths:
        response = client.get(path)
        if response.status_code != 200:
            raise RuntimeError(f'{path}: {response.status_code} {response.text[:200]}')
        print(f'OK {path}', flush=True)
    result = client.post('/api/run', json={'strategy': 'model', 'budget': 30}).json()
    if (result.get('found'), result.get('speedup')) != (13, 6.37):
        raise RuntimeError(f'Unexpected measured result: {result}')
    print(json.dumps({'ok': True, 'paths': len(paths), 'found': result['found'], 'speedup': result['speedup']}), flush=True)


if __name__ == '__main__':
    verify()
