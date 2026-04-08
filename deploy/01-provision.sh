#!/usr/bin/env bash
#
# Gorillas - Lightsail Provisioning Script
# Creates an isolated Lightsail instance for gorillas.redcrow.digital
#
# Prerequisites:
#   - AWS CLI v2 configured with credentials that have Lightsail permissions
#   - Region: ap-southeast-2 (Sydney)
#
# This script is SAFE for existing infrastructure:
#   - Lightsail is completely isolated from EC2/VPC/RDS/etc.
#   - Creates only: 1 instance, 1 static IP, firewall rules on that instance
#   - Uses unique names prefixed with "gorillas-" to avoid collisions
#
# Usage: bash deploy/01-provision.sh

set -euo pipefail

INSTANCE_NAME="gorillas-prod"
STATIC_IP_NAME="gorillas-prod-ip"
REGION="ap-southeast-2"
AZ="${REGION}a"
BLUEPRINT="ubuntu_24_04"
BUNDLE="nano_3_2"  # $3.50/mo: 512MB RAM, 1 vCPU, 1TB transfer

echo "=== Gorillas Lightsail Provisioner ==="
echo ""
echo "This will create:"
echo "  - Lightsail instance: ${INSTANCE_NAME} (${BUNDLE}, ${AZ})"
echo "  - Static IP: ${STATIC_IP_NAME}"
echo "  - Firewall: ports 22, 80, 443 only"
echo ""
echo "Estimated cost: \$3.50 USD/month"
echo "This does NOT touch EC2, VPC, RDS, or any other AWS services."
echo ""
read -p "Continue? (y/N) " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

# Check if instance already exists
if aws lightsail get-instance --instance-name "$INSTANCE_NAME" --region "$REGION" &>/dev/null; then
  echo "ERROR: Instance '${INSTANCE_NAME}' already exists. Delete it first or choose a different name."
  exit 1
fi

echo ""
echo "[1/4] Creating Lightsail instance..."
aws lightsail create-instances \
  --instance-names "$INSTANCE_NAME" \
  --availability-zone "$AZ" \
  --blueprint-id "$BLUEPRINT" \
  --bundle-id "$BUNDLE" \
  --region "$REGION" \
  --tags key=project,value=gorillas key=managed-by,value=script

echo "       Waiting for instance to be running..."
while true; do
  STATE=$(aws lightsail get-instance \
    --instance-name "$INSTANCE_NAME" \
    --region "$REGION" \
    --query 'instance.state.name' \
    --output text 2>/dev/null || echo "pending")
  if [[ "$STATE" == "running" ]]; then
    break
  fi
  echo "       State: ${STATE}... waiting 10s"
  sleep 10
done
echo "       Instance is running."

echo ""
echo "[2/4] Allocating and attaching static IP..."
aws lightsail allocate-static-ip \
  --static-ip-name "$STATIC_IP_NAME" \
  --region "$REGION" 2>/dev/null || echo "       (Static IP may already exist, continuing...)"

aws lightsail attach-static-ip \
  --static-ip-name "$STATIC_IP_NAME" \
  --instance-name "$INSTANCE_NAME" \
  --region "$REGION"

STATIC_IP=$(aws lightsail get-static-ip \
  --static-ip-name "$STATIC_IP_NAME" \
  --region "$REGION" \
  --query 'staticIp.ipAddress' \
  --output text)
echo "       Static IP: ${STATIC_IP}"

echo ""
echo "[3/4] Configuring firewall (22, 80, 443 only)..."
# Close the default open ports first, then open only what we need
aws lightsail put-instance-public-ports \
  --instance-name "$INSTANCE_NAME" \
  --region "$REGION" \
  --port-infos \
    "fromPort=22,toPort=22,protocol=tcp" \
    "fromPort=80,toPort=80,protocol=tcp" \
    "fromPort=443,toPort=443,protocol=tcp"
echo "       Firewall set: SSH(22), HTTP(80), HTTPS(443)"

echo ""
echo "[4/4] Fetching SSH key..."
# Download the default key pair for this region
KEY_FILE="gorillas-ssh-key.pem"
aws lightsail download-default-key-pair \
  --region "$REGION" \
  --query 'privateKeyBase64' \
  --output text | base64 -d > "$KEY_FILE" 2>/dev/null || \
aws lightsail download-default-key-pair \
  --region "$REGION" \
  --query 'privateKeyBase64' \
  --output text > "$KEY_FILE"
chmod 600 "$KEY_FILE"
echo "       SSH key saved to: ${KEY_FILE}"

echo ""
echo "=== DONE ==="
echo ""
echo "Instance:  ${INSTANCE_NAME}"
echo "Static IP: ${STATIC_IP}"
echo "SSH:       ssh -i ${KEY_FILE} ubuntu@${STATIC_IP}"
echo ""
echo "NEXT STEPS:"
echo "  1. Add Cloudflare DNS: A record 'gorillas' -> ${STATIC_IP} (DNS only, grey cloud)"
echo "  2. Run: bash deploy/02-setup.sh ${STATIC_IP}"
echo ""
