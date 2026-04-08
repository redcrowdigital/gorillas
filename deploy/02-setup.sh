#!/usr/bin/env bash
#
# Gorillas - Server Setup Script
# Configures a fresh Lightsail Ubuntu instance with Node.js, PM2, and Caddy
#
# Usage: bash deploy/02-setup.sh <server-ip>
#
# This SSHs into the server and runs all setup commands remotely.
# Requires the SSH key from 01-provision.sh in the current directory.

set -euo pipefail

SERVER_IP="${1:?Usage: bash deploy/02-setup.sh <server-ip>}"
KEY_FILE="gorillas-ssh-key.pem"
DOMAIN="gorillas.redcrow.digital"
REPO="https://github.com/jarvisrcd/gorillas.git"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "ERROR: SSH key '${KEY_FILE}' not found. Run 01-provision.sh first."
  exit 1
fi

echo "=== Gorillas Server Setup ==="
echo "Server: ubuntu@${SERVER_IP}"
echo "Domain: ${DOMAIN}"
echo ""
read -p "Continue? (y/N) " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

SSH_CMD="ssh -i ${KEY_FILE} -o StrictHostKeyChecking=accept-new ubuntu@${SERVER_IP}"

echo ""
echo "[1/6] Updating system packages..."
$SSH_CMD "sudo apt update && sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y"

echo ""
echo "[2/6] Installing Node.js 22 LTS..."
$SSH_CMD "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"

echo ""
echo "[3/6] Installing PM2..."
$SSH_CMD "sudo npm install -g pm2"

echo ""
echo "[4/6] Installing Caddy..."
$SSH_CMD "sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl && \
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list && \
  sudo apt update && sudo apt install -y caddy"

echo ""
echo "[5/6] Deploying Gorillas..."
$SSH_CMD "sudo git clone ${REPO} /opt/gorillas && \
  cd /opt/gorillas && \
  sudo npm install --production && \
  sudo chown -R ubuntu:ubuntu /opt/gorillas"

# Start with PM2 binding to localhost only
$SSH_CMD "cd /opt/gorillas && HOST=127.0.0.1 pm2 start server.js --name gorillas --env production && \
  pm2 save"

# Set up PM2 startup script (run as ubuntu user)
$SSH_CMD "sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu && pm2 save"

echo ""
echo "[6/6] Configuring Caddy reverse proxy..."
$SSH_CMD "sudo tee /etc/caddy/Caddyfile > /dev/null << 'CADDYEOF'
${DOMAIN} {
    reverse_proxy localhost:3001
}
CADDYEOF
sudo systemctl restart caddy"

echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Game URL: https://${DOMAIN}"
echo ""
echo "Useful commands:"
echo "  SSH:          ssh -i ${KEY_FILE} ubuntu@${SERVER_IP}"
echo "  App logs:     ssh -i ${KEY_FILE} ubuntu@${SERVER_IP} 'pm2 logs gorillas'"
echo "  App restart:  ssh -i ${KEY_FILE} ubuntu@${SERVER_IP} 'pm2 restart gorillas'"
echo "  App status:   ssh -i ${KEY_FILE} ubuntu@${SERVER_IP} 'pm2 status'"
echo "  Caddy logs:   ssh -i ${KEY_FILE} ubuntu@${SERVER_IP} 'sudo journalctl -u caddy -f'"
echo ""
echo "DEPLOY UPDATES:"
echo "  ssh -i ${KEY_FILE} ubuntu@${SERVER_IP} 'cd /opt/gorillas && git pull && npm install --production && pm2 restart gorillas'"
echo ""
