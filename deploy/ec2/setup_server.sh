#!/usr/bin/env bash
# One-time server setup for beeguard.marketpilot.it (Ubuntu 24.04, run as ubuntu with sudo).
set -euo pipefail
DOMAIN=beeguard.marketpilot.it
sudo mkdir -p /opt/beeguard && sudo chown ubuntu:ubuntu /opt/beeguard
[ -d /opt/beeguard/venv ] || python3 -m venv /opt/beeguard/venv

sudo tee /etc/systemd/system/beeguard.service > /dev/null <<UNIT
[Unit]
Description=BeeGuard Lab (API + web)
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/beeguard/app
Environment=PYTHONUTF8=1 PYTHONPATH=/opt/beeguard/app WEB_DIST=/opt/beeguard/app/apps/web/dist
ExecStart=/opt/beeguard/venv/bin/uvicorn space_app:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/nginx/sites-available/beeguard > /dev/null <<'SITE'
server {
    listen 80;
    server_name beeguard.marketpilot.it;
    client_max_body_size 2m;
    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /assets/ {
        proxy_pass http://127.0.0.1:8000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
SITE
sudo ln -sf /etc/nginx/sites-available/beeguard /etc/nginx/sites-enabled/beeguard
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload && sudo systemctl enable beeguard
if [ ! -d /etc/letsencrypt/live/$DOMAIN ]; then
  sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m ceo@marketpilot.it --redirect
fi
echo setup done
