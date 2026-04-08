#!/usr/bin/env bash
#
# Lightsail Teardown Script
# Deletes the instance and static IP created for a small app deployment.
#
# Usage:
#   INSTANCE_NAME=my-app-prod STATIC_IP_NAME=my-app-prod-ip REGION=ap-southeast-2 \
#   bash deploy/00-destroy.sh

set -euo pipefail

INSTANCE_NAME="${INSTANCE_NAME:-gorillas-prod}"
STATIC_IP_NAME="${STATIC_IP_NAME:-gorillas-prod-ip}"
REGION="${REGION:-ap-southeast-2}"
KEY_FILE="${KEY_FILE:-${INSTANCE_NAME}-ssh-key.pem}"

echo "=== Lightsail Teardown ==="
echo ""
echo "This will destroy:"
echo "  - Instance:  ${INSTANCE_NAME}"
echo "  - Static IP: ${STATIC_IP_NAME}"
echo ""
echo "This is destructive."
read -p "Type the instance name to confirm: " confirm
[[ "$confirm" == "$INSTANCE_NAME" ]] || { echo "Confirmation mismatch. Aborted."; exit 1; }

echo ""
echo "[1/3] Detaching static IP (if attached)..."
aws lightsail detach-static-ip \
  --static-ip-name "$STATIC_IP_NAME" \
  --region "$REGION" 2>/dev/null || echo "       Static IP not attached or already gone."

echo ""
echo "[2/3] Deleting instance..."
aws lightsail delete-instance \
  --instance-name "$INSTANCE_NAME" \
  --region "$REGION" 2>/dev/null || echo "       Instance already gone."

echo "       Waiting briefly for Lightsail to process deletion..."
sleep 5

echo ""
echo "[3/3] Releasing static IP..."
aws lightsail release-static-ip \
  --static-ip-name "$STATIC_IP_NAME" \
  --region "$REGION" 2>/dev/null || echo "       Static IP already gone."

if [[ -f "$KEY_FILE" ]]; then
  echo ""
  echo "Local key file still exists: ${KEY_FILE}"
  echo "Delete it manually if you no longer want it."
fi

echo ""
echo "Done."
