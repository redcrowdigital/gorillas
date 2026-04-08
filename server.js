const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = 3001;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const TICK_MS = 1000 / 60;
const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 540;
const GRAVITY = 0.28;
const MAX_PLAYERS = 2;
const MATCH_TARGET = 3;
const MAX_NAME_LENGTH = 12;
const MAX_WIND = 0.12;
const ROOM_CODE_LENGTH = 4;
const MAX_CHAT_LENGTH = 200;

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

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
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

function sanitizeRoomCode(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH);
}

function sanitizeChatText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, MAX_CHAT_LENGTH);
}

function formatWindText(wind) {
  if (wind === 0) {
    return "Calm 0%";
  }

  const direction = wind < 0 ? "Left" : "Right";
  const percent = Math.round((Math.abs(wind) / MAX_WIND) * 100);
  return `${direction} ${percent}%`;
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

function terrainAt(game, x, y) {
  for (const building of game.city) {
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

function createRoomState() {
  return {
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
}

function createRoom(code) {
  const room = {
    code,
    game: createRoomState(),
    clients: new Map(),
    playerNames: Array.from({ length: MAX_PLAYERS }, (_, slot) => defaultPlayerName(slot))
  };

  createFreshRound(room, false);
  room.game.phase = "waiting";
  room.game.status = "Waiting for two players...";
  return room;
}

function getPlayerName(room, slot) {
  return room.playerNames[slot] || defaultPlayerName(slot);
}

function resetAim(game) {
  game.aim = [
    { angle: 45, power: 52 },
    { angle: 315, power: 52 }
  ];
}

function createFreshRound(room, keepScores = true) {
  const { game } = room;
  game.city = generateCity();
  game.gorillas = pickPerches(game.city).map((gorilla) => ({
    ...gorilla,
    alive: true,
    pose: "idle"
  }));
  game.banana = null;
  game.explosion = null;
  game.phase = "aiming";
  game.roundWinner = null;
  game.matchWinner = null;
  game.nextRoundAt = null;
  game.wind = parseFloat(rand(-MAX_WIND, MAX_WIND).toFixed(3));
  game.status = `${getPlayerName(room, game.activePlayer)}'s turn`;
  if (!keepScores) {
    game.scores = [0, 0];
  }
  resetAim(game);
}

function refreshStatusText(room) {
  const { game } = room;

  if (game.phase === "aiming") {
    game.status = `${getPlayerName(room, game.activePlayer)}'s turn`;
    return;
  }

  if (game.phase === "roundOver" && game.roundWinner !== null) {
    game.roundMessage = `${getPlayerName(room, game.roundWinner)} scores!`;
    game.status = `${getPlayerName(room, game.roundWinner)} won the round. New skyline in a moment...`;
    return;
  }

  if (game.phase === "matchOver" && game.matchWinner !== null) {
    game.roundMessage = `${getPlayerName(room, game.matchWinner)} scores!`;
    game.status = `${getPlayerName(room, game.matchWinner)} wins the match! Press New Match.`;
  }
}

function serializeState(room) {
  return {
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    roomCode: room.code,
    players: Array.from({ length: MAX_PLAYERS }, (_, slot) => {
      const entry = [...room.clients.values()].find((client) => client.slot === slot);
      return {
        slot,
        connected: Boolean(entry),
        name: getPlayerName(room, slot)
      };
    }),
    game: room.game
  };
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload = {}) {
  for (const ws of room.clients.keys()) {
    send(ws, type, payload);
  }
}

function broadcastState(room) {
  broadcast(room, "state", { state: serializeState(room) });
}

function connectedCount(room) {
  return room.clients.size;
}

function slotAvailable(room, slot) {
  return ![...room.clients.values()].some((client) => client.slot === slot);
}

function assignSlot(room) {
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) {
    if (slotAvailable(room, slot)) {
      return slot;
    }
  }
  return -1;
}

function startMatch(room) {
  room.game.activePlayer = Math.random() > 0.5 ? 0 : 1;
  createFreshRound(room, false);
  room.game.phase = "aiming";
  room.game.status = `${getPlayerName(room, room.game.activePlayer)}'s turn`;
}

function maybeStartWhenReady(room) {
  if (connectedCount(room) === MAX_PLAYERS) {
    startMatch(room);
  } else {
    room.game.phase = "waiting";
    room.game.status = "Waiting for two players...";
    room.game.banana = null;
    room.game.explosion = null;
  }
  broadcastState(room);
}

function makeExplosion(room, x, y, radius, hitSlot = null) {
  const { game } = room;
  game.explosion = { x, y, radius, ttl: 28 };

  for (const building of game.city) {
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
    for (const gorilla of game.gorillas) {
      if (gorillaAlive(gorilla) && gorillaHit(gorilla, x, y, radius)) {
        victim = gorilla.slot;
        break;
      }
    }
  }

  if (victim !== null) {
    game.gorillas[victim].alive = false;
    const winner = victim === 0 ? 1 : 0;
    const winnerName = getPlayerName(room, winner);
    game.scores[winner] += 1;
    game.roundWinner = winner;
    game.roundMessage = `${winnerName} scores!`;

    if (game.scores[winner] >= MATCH_TARGET) {
      game.matchWinner = winner;
      game.phase = "matchOver";
      game.status = `${winnerName} wins the match! Press New Match.`;
    } else {
      game.phase = "roundOver";
      game.status = `${winnerName} won the round. New skyline in a moment...`;
      game.nextRoundAt = Date.now() + 2200;
    }
  } else {
    game.activePlayer = game.activePlayer === 0 ? 1 : 0;
    game.wind = parseFloat(rand(-MAX_WIND, MAX_WIND).toFixed(3));
    game.phase = "aiming";
    game.status = `${getPlayerName(room, game.activePlayer)}'s turn`;
  }
}

function fireBanana(room, slot) {
  const { game } = room;
  if (game.phase !== "aiming" || game.activePlayer !== slot || connectedCount(room) < MAX_PLAYERS) {
    return;
  }

  const thrower = game.gorillas[slot];
  if (!thrower || !gorillaAlive(thrower)) {
    return;
  }

  const { angle, power } = game.aim[slot];
  const radians = (angle * Math.PI) / 180;
  const speed = power / 4;
  const velocityX = Math.sin(radians) * speed;
  const velocityY = -Math.cos(radians) * speed;

  game.banana = {
    x: thrower.x + Math.sign(velocityX) * 30,
    y: thrower.y - 30,
    vx: velocityX,
    vy: velocityY,
    owner: slot,
    rotation: 0
  };

  thrower.pose = "throw";
  game.phase = "projectile";
  game.status = `Banana airborne... wind ${formatWindText(game.wind)}`;
}

function updateProjectile(room) {
  const { game } = room;
  if (!game.banana) {
    return;
  }

  const banana = game.banana;
  banana.vx += game.wind;
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
      makeExplosion(room, banana.x, banana.y, 34, gorilla.slot);
      return;
    }
  }

  if (terrainAt(game, banana.x, banana.y)) {
    game.banana = null;
    makeExplosion(room, banana.x, banana.y, 30);
    return;
  }

  if (banana.x < -60 || banana.x > ARENA_WIDTH + 60 || banana.y > ARENA_HEIGHT + 60 || banana.y < -120) {
    game.banana = null;
    game.activePlayer = game.activePlayer === 0 ? 1 : 0;
    game.wind = parseFloat(rand(-MAX_WIND, MAX_WIND).toFixed(3));
    game.phase = "aiming";
    game.status = `Missed. ${getPlayerName(room, game.activePlayer)}'s turn`;
  }
}

function updateExplosion(room) {
  const { game } = room;
  if (!game.explosion) {
    return;
  }
  game.explosion.ttl -= 1;
  if (game.explosion.ttl <= 0) {
    game.explosion = null;
  }
}

const rooms = new Map();
const socketMeta = new Map();

function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";

  do {
    code = "";
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += letters[randInt(0, letters.length - 1)];
    }
  } while (rooms.has(code));

  return code;
}

function getClientRoom(ws) {
  const meta = socketMeta.get(ws);
  return meta ? rooms.get(meta.roomCode) || null : null;
}

function detachClient(ws) {
  const meta = socketMeta.get(ws);
  if (!meta) {
    return null;
  }

  const room = rooms.get(meta.roomCode);
  socketMeta.delete(ws);
  if (!room) {
    return null;
  }

  const client = room.clients.get(ws);
  room.clients.delete(ws);
  if (room.clients.size === 0) {
    rooms.delete(room.code);
  }

  return { room, client };
}

function joinRoom(ws, room) {
  if (socketMeta.has(ws)) {
    send(ws, "error", { message: "You are already in a room." });
    return;
  }

  const slot = assignSlot(room);
  if (slot === -1) {
    send(ws, "error", { message: `Room ${room.code} is full.` });
    return;
  }

  const client = { slot, name: getPlayerName(room, slot) };
  room.clients.set(ws, client);
  socketMeta.set(ws, { roomCode: room.code });

  send(ws, "roomJoined", { code: room.code });
  send(ws, "welcome", { slot, targetScore: MATCH_TARGET, code: room.code });
  broadcast(room, "toast", { message: `${getPlayerName(room, slot)} connected.` });
  maybeStartWhenReady(room);
}

function handleCreateRoom(ws) {
  if (socketMeta.has(ws)) {
    send(ws, "error", { message: "You are already in a room." });
    return;
  }

  const code = generateRoomCode();
  const room = createRoom(code);
  rooms.set(code, room);
  send(ws, "roomCreated", { code });
  joinRoom(ws, room);
}

function handleJoinRoom(ws, code) {
  if (socketMeta.has(ws)) {
    send(ws, "error", { message: "You are already in a room." });
    return;
  }

  const roomCode = sanitizeRoomCode(code);
  if (roomCode.length !== ROOM_CODE_LENGTH) {
    send(ws, "error", { message: "Enter a valid 4-letter room code." });
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    send(ws, "error", { message: `Room ${roomCode} was not found.` });
    return;
  }

  joinRoom(ws, room);
}

function handleChat(ws, text) {
  const room = getClientRoom(ws);
  if (!room) {
    return;
  }

  const client = room.clients.get(ws);
  if (!client) {
    return;
  }

  const message = sanitizeChatText(text);
  if (!message) {
    return;
  }

  broadcast(room, "chat", { from: client.name, text: message });
}

function tick() {
  for (const room of rooms.values()) {
    const { game } = room;

    if (game.phase === "projectile") {
      updateProjectile(room);
    }

    updateExplosion(room);

    for (const gorilla of game.gorillas) {
      if (gorilla.pose === "throw" && game.phase !== "projectile") {
        gorilla.pose = "idle";
      }
    }

    if (game.phase === "roundOver" && game.nextRoundAt && Date.now() >= game.nextRoundAt) {
      createFreshRound(room, true);
    }

    broadcastState(room);
  }
}

const server = http.createServer((req, res) => {
  const requestPath = req.url ? new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname : "/";
  const requestedPath = requestPath === "/" ? "/index.html" : requestPath;
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
  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      return;
    }

    if (message.type === "createRoom") {
      handleCreateRoom(ws);
      return;
    }

    if (message.type === "joinRoom") {
      handleJoinRoom(ws, message.code);
      return;
    }

    const room = getClientRoom(ws);
    if (!room) {
      send(ws, "error", { message: "Join a room first." });
      return;
    }

    const client = room.clients.get(ws);
    if (!client) {
      return;
    }

    if (message.type === "aim") {
      const current = room.game.aim[client.slot];
      if (!current) {
        return;
      }
      current.angle = clamp(finiteOr(Number(message.angle), current.angle), 0, 359);
      current.power = clamp(finiteOr(Number(message.power), current.power), 10, 100);
      broadcastState(room);
      return;
    }

    if (message.type === "setName") {
      const name = sanitizePlayerName(message.name, client.slot);
      client.name = name;
      room.playerNames[client.slot] = name;
      refreshStatusText(room);
      broadcast(room, "toast", { message: `${name} is ready.` });
      broadcastState(room);
      return;
    }

    if (message.type === "throw") {
      fireBanana(room, client.slot);
      broadcastState(room);
      return;
    }

    if (message.type === "restart") {
      if (connectedCount(room) === MAX_PLAYERS) {
        startMatch(room);
        broadcast(room, "toast", { message: "New match started." });
        broadcastState(room);
      }
      return;
    }

    if (message.type === "chat") {
      handleChat(ws, message.text);
    }
  });

  ws.on("close", () => {
    const detached = detachClient(ws);
    if (!detached || !detached.room || !detached.client) {
      return;
    }

    const { room, client } = detached;
    if (room.clients.size > 0) {
      broadcast(room, "toast", { message: `${getPlayerName(room, client.slot)} disconnected.` });
      maybeStartWhenReady(room);
    }
  });
});

setInterval(tick, TICK_MS);

server.listen(PORT, HOST, () => {
  console.log(`Gorillas server running on http://0.0.0.0:${PORT}`);
});
