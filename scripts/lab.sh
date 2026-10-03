#!/usr/bin/env bash
# Run the BeeGuard lab through Omnigent.
#
#   bash scripts/lab.sh "Run one full discovery loop and report what you measured."
#
# The server starts first and the run attaches to it: starting the run on its
# own hit a startup timeout on this host.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OMNIGENT_PORT:-6799}"
PROMPT="${1:-Run one full discovery loop and report the acceleration you measured.}"

export PYTHONUTF8=1                  # a cp949 host breaks the daemon handshake
export OMNIGENT_DISABLE_TELEMETRY=1
export PYTHONPATH="$ROOT"            # so callable: lab.beeguard.tools.* resolves

cd "$ROOT"

if ! curl -s -m 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "starting omnigent server on ${PORT}"
  omnigent server --port "$PORT" > .omnigent-server.log 2>&1 &
  for _ in $(seq 1 40); do
    sleep 1
    curl -s -m 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && break
  done
fi

omnigent run agents/beeguard --server "http://127.0.0.1:${PORT}" -p "$PROMPT" < /dev/null
