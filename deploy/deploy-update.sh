#!/usr/bin/env bash
#
# Quick deploy: pull latest code and restart
# Usage: bash deploy/deploy-update.sh <server-ip>

set -euo pipefail

SERVER_IP="${1:?Usage: bash deploy/deploy-update.sh <server-ip>}"
KEY_FILE="gorillas-ssh-key.pem"

ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new "ubuntu@${SERVER_IP}" \
  "cd /opt/gorillas && git pull && npm install --production && pm2 restart gorillas"

echo "Deployed latest to ${SERVER_IP}"
