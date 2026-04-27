# Gorillas Clone

Retro two-player LAN Gorillas built with vanilla JavaScript, HTML5 canvas, Node.js, and WebSockets.

## Features

- Turn-based banana artillery for 2 players
- Random skyline generation with destructible buildings
- Wind and gravity affecting every shot
- Score tracking, first player to 3 wins
- Retro dark pixel-style presentation
- Single server serving static files and authoritative WebSocket game state
- Room codes, spectators, chat, queue rotation, heartbeat cleanup, and basic message throttling

## Run

```bash
npm install
npm start
```

Open `http://localhost:3001` in two browsers or on two devices on the same LAN.

Use a custom host or port when needed:

```bash
HOST=127.0.0.1 PORT=3002 npm start
```

Health check:

```bash
curl http://localhost:3001/healthz
```

## Development

```bash
npm run check
npm test
```

## Deploy

This repo includes optional generic deployment scripts for a small Ubuntu/Lightsail box with Caddy + PM2.

**Tear down a server:**
```bash
INSTANCE_NAME=gorillas-prod STATIC_IP_NAME=gorillas-prod-ip REGION=ap-southeast-2 \
  bash deploy/00-destroy.sh
```

**Provision a server:**
```bash
INSTANCE_NAME=gorillas-prod STATIC_IP_NAME=gorillas-prod-ip REGION=ap-southeast-2 \
  bash deploy/01-provision.sh
```

**Set up the app on the server:**
```bash
DOMAIN=gorillas.redcrow.digital REPO=https://github.com/redcrowdigital/gorillas.git \
APP_NAME=gorillas APP_DIR=/opt/gorillas KEY_FILE=gorillas-prod-ssh-key.pem \
  bash deploy/02-setup.sh <server-ip>
```

**Deploy updates:**
```bash
APP_NAME=gorillas APP_DIR=/opt/gorillas KEY_FILE=gorillas-prod-ssh-key.pem \
  bash deploy/deploy-update.sh <server-ip>
```

For a generic self-hosting guide, see [DEPLOY.md](./DEPLOY.md).

## Controls

- `Arrow Up / Down`: change angle
- `Arrow Left / Right`: change power
- `Space` or `Enter`: throw banana
- You can also use the on-screen sliders and buttons
