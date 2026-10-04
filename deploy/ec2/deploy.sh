#!/usr/bin/env bash
# Build the web app, stage the runtime files and ship them to beeguard.marketpilot.it.
#   bash deploy/ec2/deploy.sh [--no-build]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST=${BEEGUARD_HOST:-ubuntu@13.125.16.61}
KEY=${BEEGUARD_KEY:-$HOME/.ssh/beeguard-demo.pem}
SSH="ssh -i $KEY -o StrictHostKeyChecking=no"

if [ "${1:-}" != "--no-build" ]; then
  (cd "$ROOT/apps/web" && npx vite build > /dev/null && echo "web built")
fi
STAGE="$(mktemp -d)"
python "$ROOT/deploy/stage_cli.py" "$STAGE"
tar -C "$STAGE" -czf "$STAGE.tgz" .
$SSH "$HOST" "rm -rf /opt/beeguard/next && mkdir -p /opt/beeguard/next"
cat "$STAGE.tgz" | $SSH "$HOST" "tar -xzf - -C /opt/beeguard/next"
$SSH "$HOST" "/opt/beeguard/venv/bin/pip install -q -r /opt/beeguard/next/requirements.txt && rm -rf /opt/beeguard/prev && { [ -d /opt/beeguard/app ] && mv /opt/beeguard/app /opt/beeguard/prev || true; } && mv /opt/beeguard/next /opt/beeguard/app && sudo systemctl restart beeguard"
rm -rf "$STAGE" "$STAGE.tgz"
for i in $(seq 1 40); do
  if $SSH "$HOST" "curl -sf http://127.0.0.1:8000/api/health" > /dev/null 2>&1; then break; fi
  sleep 2
done
$SSH "$HOST" "curl -s http://127.0.0.1:8000/api/health; echo; for p in /api/facts /api/eras '/api/curve?strategy=model&budget=30'; do curl -s -o /dev/null -w \"\$p %{http_code} %{time_total}s\n\" \"http://127.0.0.1:8000\$p\"; done"
echo "live: https://beeguard.marketpilot.it"
