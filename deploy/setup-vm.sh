#!/usr/bin/env bash
# Configuració inicial d'una VM Ubuntu (Oracle Cloud Ampere A1) per al Centre de Control.
# Executa-ho com a usuari normal (ubuntu); el script fa servir sudo quan cal.
set -euo pipefail

echo "== 1/5 Actualitzant el sistema =="
sudo apt-get update
sudo apt-get upgrade -y

echo "== 2/5 Instal·lant Node.js 22 LTS (NodeSource) =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

echo "== 3/5 Instal·lant Nginx i Certbot =="
sudo apt-get install -y nginx certbot python3-certbot-nginx

echo "== 4/5 Instal·lant PM2 =="
sudo npm install -g pm2

echo "== 5/5 Obrint ports al tallafoc local (iptables d'Oracle) =="
# Oracle Ubuntu porta regles iptables restrictives per defecte
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || echo "AVÍS: instal·la iptables-persistent per guardar les regles (sudo apt install iptables-persistent)"

echo ""
echo "Fet! Recorda també:"
echo " 1. Obrir els ports 80 i 443 a la Security List / NSG de la consola d'Oracle Cloud."
echo " 2. Apuntar el teu domini (registre A) a la IP pública de la VM."
echo " 3. Seguir el README per desplegar l'app i demanar el certificat amb Certbot."
