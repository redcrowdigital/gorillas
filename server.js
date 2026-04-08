const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = 3001;
const PUBLIC_DIR = path.join(__dirname, "public");
const TICK_MS = 1000 / 60;
const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 540;
const GRAVITY = 0.28;
const MAX_PLAYERS = 2;
const MATCH_TARGET = 3;
const MAX_NAME_LENGTH = 12;
const MAX_WIND = 0.12;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultPlayerName(slot) {
  return `Player ${slot + 1}`;
}

function sanitizePlayerName(value, slot) {
  const fallback = defaultPlayerName(slot);
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || fallback;
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function makeBuildingWindows(x, width, topY, height) {
  const windows = [];
  const cols = Math.max(1, Math.floor((width - 10) / 12));
  const rows = Math.max(1, Math.floor((height - 16) / 16));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (Math.random() < 0.18) {
        continue;
      }
      windows.push({
        x: x + 6 + col * 12,
        y: topY + 8 + row * 16,
        lit: Math.random() > 0.35
      });
    }
  }

  return windows;
}

function generateCity() {
  const buildings = [];
  let cursor = 0;

  while (cursor < ARENA_WIDTH) {
    const remaining = ARENA_WIDTH - cursor;
    const width = Math.min(remaining, randInt(56, 92));
    const height = randInt(140, 350);
    const topY = ARENA_HEIGHT - height;
    buildings.push({
      x: cursor,
      width,
      height,
      topY,
      color: `hsl(${randInt(190, 240)} 18% ${randInt(18, 30)}%)`,
      windows: makeBuildingWindows(cursor, width, topY, height),
      holes: []
    });
    cursor += width;
  }

  return buildings;
}

function pickPerches(buildings) {
  const leftChoices = buildings.slice(1, Math.max(2, Math.floor(buildings.length / 2)));
  const rightChoices = buildings.slice(Math.floor(buildings.length / 2), Math.max(buildings.length - 1, 1));
  const first = leftChoices[randInt(0, leftChoices.length - 1)];
  const second = rightChoices[randInt(0, rightChoices.length - 1)];

  return [
    {
      x: first.x + first.width / 2,
      y: first.topY - 10,
      radius: 14,
      slot: 0,
      buildingIndex: buildings.indexOf(first)
    },
    {
      x: second.x + second.width / 2,
      y: second.topY - 10,
      radius: 14,
      slot: 1,
      buildingIndex: buildings.indexOf(second)
    }
  ];
}

function buildingSolidAt(building, x, y) {
  if (x < building.x || x > building.x + building.width || y < building.topY || y > ARENA_HEIGHT) {
    return false;
  }

  for (const hole of building.holes) {
    const dx = x - hole.x;
    const dy = y - hole.y;
    if (dx * dx + dy * dy <= hole.radius * hole.radius) {
      return false;
    }
  }

  return true;
}

function terrainAt(state, x, y) {
  for (const building of state.city) {
    if (buildingSolidAt(building, x, y)) {
      return true;
    }
  }
  return false;
}

function gorillaAlive(gorilla) {
  return gorilla.alive !== false;
}

function gorillaHit(gorilla, x, y, radius = 0) {
  const dx = x - gorilla.x;
  const dy = y - gorilla.y;
  const hitRadius = gorilla.radius + radius;
  return dx * dx + dy * dy <= hitRadius * hitRadius;
}

function makeExplosion(state, x, y, radius, hitSlot = null, ownerSlot = null) {
  state.explosion = { x, y, radius, ttl: 28 };

  for (const building of state.city) {
    if (x + radius < building.x || x - radius > building.x + building.width) {
      continue;
    }
    if (y + radius < building.topY || y - radius > ARENA_HEIGHT) {
      continue;
    }
    building.holes.push({ x, y, radius });
  }

  let victim = hitSlot;
  if (victim === null) {
    for (const gorilla of state.gorillas) {
      if (gorilla.slot === ownerSlot) continue;  // immune to own explosion
      if (gorillaAlive(gorilla) && gorillaHit(gorilla, x, y, radius)) {
        victim = gorilla.slot;
        break;
      }
    }
  }

  if (victim !== null) {
    state.gorillas[victim].alive = false;
    const winner = victim === 0 ? 1 : 0;
    const winnerName = getPlayerName(winner);
    state.scores[winner] += 1;
    state.roundWinner = winner;
    state.roundMessage = `${winnerName} scores!`;
    // Don't carry winner advantage — random start each round

    if (state.scores[winner] >= MATCH_TARGET) {
      state.matchWinner = winner;
      state.phase = "matchOver";
      state.status = `${winnerName} wins the match! Press New Match.`;
    } else {
      state.phase = "roundOver";
      state.status = `${winnerName} won the round. New skyline in a moment...`;
      state.nextRoundAt = Date.now() + 2200;
    }
  } else {
    state.activePlayer = state.activePlayer === 0 ? 1 : 0;
    state.wind = parseFloat(rand(-MAX_WIND, MAX_WIND).toFixed(3));
    state.phase = "aiming";
    state.status = `${getPlayerName(state.activePlayer)}'s turn`;
  }
}

function resetAim(state) {
  state.aim = [
    { angle: 45, power: 52 },
    { angle: 315, power: 52 }
  ];
}

function createFreshRound(state, keepScores = true) {
  state.city = generateCity();
  state.gorillas = pickPerches(state.city).map((gorilla) => ({
    ...gorilla,
    alive: true,
    pose: "idle"
  }));
  state.banana = null;
  state.explosion = null;
  state.phase = "aiming";
  state.roundWinner = null;
  state.matchWinner = null;
  state.nextRoundAt = null;
  state.wind = parseFloat(rand(-MAX_WIND, MAX_WIND).toFixed(3));
  state.status = `${getPlayerName(state.activePlayer)}'s turn`;
  if (!keepScores) {
    state.scores = [0, 0];
  }
  resetAim(state);
}

function createInitialState() {
  const state = {
    city: [],
    gorillas: [],
    scores: [0, 0],
    aim: [],
    activePlayer: 0,
    wind: 0,
    banana: null,
    explosion: null,
    phase: "waiting",
    status: "Waiting for two players...",
    roundWinner: null,
    matchWinner: null,
    nextRoundAt: null
  };
  createFreshRound(state, false);
  state.phase = "waiting";
  state.status = "Waiting for two players...";
  return state;
}

const playerNames = Array.from({ length: MAX_PLAYERS }, (_, slot) => defaultPlayerName(slot));

function getPlayerName(slot) {
  return playerNames[slot] || defaultPlayerName(slot);
}

const game = createInitialState();
const clients = new Map();

function refreshStatusText() {
  if (game.phase === "aiming") {
    game.status = `${getPlayerName(game.activePlayer)}'s turn`;
    return;
  }

  if (game.phase === "roundOver" && game.roundWinner !== null) {
    game.roundMessage = `${getPlayerName(game.roundWinner)} scores!`;
    game.status = `${getPlayerName(game.roundWinner)} won the round. New skyline in a moment...`;
    return;
  }

  if (game.phase === "matchOver" && game.matchWinner !== null) {
    game.roundMessage = `${getPlayerName(game.matchWinner)} scores!`;
    game.status = `${getPlayerName(game.matchWinner)} wins the match! Press New Match.`;
  }
}

function serializeState() {
  return {
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    players: Array.from({ length: MAX_PLAYERS }, (_, slot) => {
      const entry = [...clients.values()].find((client) => client.slot === slot);
      return {
        slot,
        connected: Boolean(entry),
        name: getPlayerName(slot)
      };
    }),
    game
  };
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(type, payload = {}) {
  for (const ws of clients.keys()) {
    send(ws, type, payload);
  }
}

function broadcastState() {
  broadcast("state", { state: serializeState() });
}

function connectedCount() {
  return [...clients.values()].length;
}

function slotAvailable(slot) {
  return ![...clients.values()].some((client) => client.slot === slot);
}

function assignSlot() {
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) {
    if (slotAvailable(slot)) {
      return slot;
    }
  }
  return -1;
}

function startMatch() {
  game.activePlayer = Math.random() > 0.5 ? 0 : 1;
  createFreshRound(game, false);
  game.phase = "aiming";
  game.status = `${getPlayerName(game.activePlayer)}'s turn`;
}

function maybeStartWhenReady() {
  if (connectedCount() === MAX_PLAYERS) {
    startMatch();
  } else {
    game.phase = "waiting";
    game.status = "Waiting for two players...";
    game.banana = null;
    game.explosion = null;
  }
  broadcastState();
}

function fireBanana(slot) {
  if (game.phase !== "aiming" || game.activePlayer !== slot || connectedCount() < MAX_PLAYERS) {
    return;
  }

  const thrower = game.gorillas[slot];
  if (!thrower || !gorillaAlive(thrower)) {
    return;
  }

  const { angle, power } = game.aim[slot];
  // Compass convention: 0° = up, 90° = right, 180° = down, 270° = left
  const radians = (angle * Math.PI) / 180;
  const speed = power / 4;
  const velocityX = Math.sin(radians) * speed;
  const velocityY = -Math.cos(radians) * speed;

  game.banana = {
    x: thrower.x + Math.sign(velocityX) * 30,
    y: thrower.y - 14,
    vx: velocityX,
    vy: velocityY,
    owner: slot,
    rotation: 0
  };

  thrower.pose = "throw";
  game.phase = "projectile";
  game.status = `Banana airborne... wind ${game.wind > 0 ? ">" : "<"} ${Math.abs(game.wind).toFixed(3)}`;
}

function updateProjectile() {
  if (!game.banana) {
    return;
  }

  const banana = game.banana;
  banana.vx += game.wind;  // wind applied directly to VX, like original GORILLA.BAS
  banana.vy += GRAVITY;
  banana.x += banana.vx;
  banana.y += banana.vy;
  banana.rotation += 0.28;

  for (const gorilla of game.gorillas) {
    if (gorilla.slot === banana.owner || !gorillaAlive(gorilla)) {
      continue;
    }
    if (gorillaHit(gorilla, banana.x, banana.y, 4)) {
      game.banana = null;
      makeExplosion(game, banana.x, banana.y, 34, gorilla.slot);
      return;
    }
  }

  if (terrainAt(game, banana.x, banana.y)) {
    game.banana = null;
    makeExplosion(game, banana.x, banana.y, 30, null, banana.owner);
    return;
  }

  if (banana.x < -60 || banana.x > ARENA_WIDTH + 60 || banana.y > ARENA_HEIGHT + 60 || banana.y < -120) {
    game.banana = null;
    game.activePlayer = game.activePlayer === 0 ? 1 : 0;
    game.wind = parseFloat(rand(-MAX_WIND, MAX_WIND).toFixed(3));
    game.phase = "aiming";
    game.status = `Missed. ${getPlayerName(game.activePlayer)}'s turn`;
  }
}

function updateExplosion() {
  if (!game.explosion) {
    return;
  }
  game.explosion.ttl -= 1;
  if (game.explosion.ttl <= 0) {
    game.explosion = null;
  }
}

function tick() {
  if (game.phase === "projectile") {
    updateProjectile();
  }

  updateExplosion();

  for (const gorilla of game.gorillas) {
    if (gorilla.pose === "throw" && game.phase !== "projectile") {
      gorilla.pose = "idle";
    }
  }

  if (game.phase === "roundOver" && game.nextRoundAt && Date.now() >= game.nextRoundAt) {
    createFreshRound(game, true);
  }

  broadcastState();
}

const server = http.createServer((req, res) => {
  const requestedPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  const slot = assignSlot();

  if (slot === -1) {
    send(ws, "error", { message: "Game full. Only two players can join this match." });
    ws.close();
    return;
  }

  clients.set(ws, { slot, name: getPlayerName(slot) });
  send(ws, "welcome", { slot, targetScore: MATCH_TARGET });
  broadcast("toast", { message: `${getPlayerName(slot)} connected.` });
  maybeStartWhenReady();

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      return;
    }

    const client = clients.get(ws);
    if (!client) {
      return;
    }

    if (message.type === "aim") {
      const current = game.aim[client.slot];
      if (!current) {
        return;
      }
      current.angle = clamp(Number(message.angle) ?? current.angle, 0, 359);
      current.power = clamp(Number(message.power) || current.power, 10, 100);
      broadcastState();
      return;
    }

    if (message.type === "setName") {
      const name = sanitizePlayerName(message.name, client.slot);
      client.name = name;
      playerNames[client.slot] = name;
      refreshStatusText();
      broadcast("toast", { message: `${name} is ready.` });
      broadcastState();
      return;
    }

    if (message.type === "throw") {
      fireBanana(client.slot);
      broadcastState();
      return;
    }

    if (message.type === "restart") {
      if (connectedCount() === MAX_PLAYERS) {
        startMatch();
        broadcast("toast", { message: "New match started." });
        broadcastState();
      }
    }
  });

  ws.on("close", () => {
    const client = clients.get(ws);
    clients.delete(ws);
    if (client) {
      broadcast("toast", { message: `${getPlayerName(client.slot)} disconnected.` });
    }
    maybeStartWhenReady();
  });
});

setInterval(tick, TICK_MS);

server.listen(PORT, () => {
  console.log(`Gorillas server running on http://0.0.0.0:${PORT}`);
});
