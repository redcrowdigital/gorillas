# Repository Guide

## Overview

This repository is a small web-based multiplayer clone of the classic Gorillas artillery game. It uses:

- Node.js HTTP server for static assets
- `ws` WebSocket server for multiplayer state
- Vanilla HTML, CSS, and browser JavaScript
- HTML5 canvas for rendering the game

There is no build step or frontend framework. The app runs directly from `server.js` and serves files from `public/`.

## Run Commands

```bash
npm install
npm start
```

The server listens on `http://localhost:3001` by default. Open the URL in two browser windows or devices to play.

Useful local checks:

```bash
npm run check
npm test
```

Production deployments can bind to localhost behind a reverse proxy:

```bash
HOST=127.0.0.1 PORT=3001 node server.js
```

The health endpoint is `GET /healthz`.

## File Map

- `server.js`: WebSocket routing, room registry, heartbeat, rate limiting, and tick loop.
- `lib/config.js`: Runtime constants and environment-derived `HOST`/`PORT`.
- `lib/game-state.js`: Room management, authoritative game simulation, scoring, spectator queue, and state serialization.
- `lib/protocol.js`: Protocol version, sanitizers, formatting, and WebSocket send/broadcast helpers.
- `lib/static-server.js`: Static asset handling and `/healthz`.
- `public/index.html`: Lobby, room UI, game canvas, controls, chat, rosters, invite UI, and name modal.
- `public/game.js`: Browser client. Handles WebSocket messages, lobby flow, input controls, chat UI, HUD updates, and canvas rendering.
- `public/style.css`: Retro dark visual styling and responsive layout.
- `public/rcd-logo.svg`: Footer/logo asset.
- `README.md`: User-facing overview, run instructions, deployment examples, and controls.
- `DEPLOY.md`: Generic self-hosting notes for Node 18+ behind a reverse proxy.
- `deploy/`: Optional AWS Lightsail, Caddy, and PM2 provisioning/update/teardown scripts.
- `test/`: Node test suite for protocol sanitization and core room/game state behavior.

## Runtime Architecture

The server is authoritative. Clients send intents such as room creation, join requests, aim changes, throw requests, restarts, names, and chat messages. The server validates those messages, mutates room state, and broadcasts snapshots.

Important server concepts:

- Rooms use 4-letter uppercase codes.
- Each room supports two active players plus spectators up to `ROOM_CAPACITY`.
- Extra participants are spectators and are tracked in a queue.
- After a scored round, if spectators are waiting, the winner stays active and the loser moves to the queue.
- The game target is first to 3 points.
- Projectile physics, wind, collision, explosions, destructible terrain, and scoring happen in `lib/game-state.js`.
- The game loop runs at 60 FPS via `setInterval(tick, TICK_MS)`.
- State broadcasts are immediate for state changes and throttled during projectile/explosion motion.
- WebSocket clients are checked with ping/pong heartbeat and message rate limiting.

The browser is mostly a renderer and UI controller:

- It connects to the same origin via WebSocket.
- It renders the latest server snapshot to the canvas.
- It disables controls unless the local participant is an active player, it is their turn, and their name has been submitted.
- It supports direct room joins via `?room=CODE`.

## WebSocket Message Types

Client to server:

- `createRoom`
- `joinRoom` with `code`
- `aim` with `angle` and `power`
- `setName` with `name`
- `throw`
- `restart`
- `chat` with `text`

Server to client:

- `roomCreated`
- `roomJoined`
- `welcome`
- `state`
- `chat`
- `toast`
- `error`

## Implementation Notes

- Keep multiplayer authority in `server.js`; do not trust browser state for gameplay outcomes.
- Sanitize user-controlled values. Existing helpers cover names, room codes, chat text, numeric aim values, and clamping.
- When changing state shape in `serializeState`, bump/review `PROTOCOL_VERSION` in `lib/protocol.js` and update `public/game.js` consumers at the same time.
- Canvas drawing in `public/game.js` assumes the arena dimensions sent by the server are compatible with the fixed canvas size in `index.html`.
- The static file server normalizes request paths and blocks traversal outside `public/`.
- The codebase uses CommonJS on the server and plain browser globals on the frontend.
- Keep `npm run check` and `npm test` passing after changes.

## Deployment Notes

The deploy scripts are optional and target a small Ubuntu AWS Lightsail instance:

- `deploy/01-provision.sh`: Creates the Lightsail instance, static IP, firewall rules, and downloads an SSH key.
- `deploy/02-setup.sh`: Installs Node.js 22, PM2, Caddy, clones the repo, installs production dependencies, starts PM2, and configures Caddy.
- `deploy/deploy-update.sh`: Pulls the latest code, installs production dependencies, and restarts PM2.
- `deploy/00-destroy.sh`: Deletes the instance and releases the static IP after confirmation.

These scripts are interactive and call remote/cloud services. Do not run them casually during local development.
