#!/usr/bin/env bash
# Instal·la Tailscale a la VM i publica el Centre de Control amb HTTPS privat.
set -euo pipefail

if ! command -v tailscale >/dev/null 2>&1; then
  echo "== Instal·lant Tailscale =="
  curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "== Iniciant sessió a Tailscale (segueix l'enllaç que apareixerà) =="
sudo tailscale up

echo "== Publicant el port 3000 amb HTTPS dins la teva xarxa Tailscale =="
sudo tailscale serve --bg 3000

echo ""
echo "Fet! El panell quedarà disponible a:"
tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | sed 's/.*"DNSName": *"\([^"]*\)\.".*/  https:\/\/\1/'
echo ""
echo "Recorda:"
echo " 1. Posar aquesta URL com a BASE_URL i al SPOTIFY_REDIRECT_URI del .env"
echo " 2. Afegir el redirect URI al Spotify Developer Dashboard"
echo " 3. Instal·lar l'app Tailscale a l'iPhone amb el mateix compte"
