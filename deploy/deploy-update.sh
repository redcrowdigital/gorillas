#!/usr/bin/env bash
#
# Quick deploy: pull latest code and restart
# Usage:
#   APP_NAME=my-app APP_DIR=/opt/my-app KEY_FILE=my-key.pem \
#   bash deploy/deploy-update.sh <server-ip>

set -euo pipefail

SERVER_IP="${1:?Usage: bash deploy/deploy-update.sh <server-ip>}"
APP_NAME="${APP_NAME:-gorillas}"
APP_DIR="${APP_DIR:-/opt/gorillas}"
KEY_FILE="${KEY_FILE:-gorillas-prod-ssh-key.pem}"

ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new "ubuntu@${SERVER_IP}" \
  "cd ${APP_DIR} && git pull && npm install --production && pm2 restart ${APP_NAME}"

echo "Deployed latest to ${SERVER_IP}"
