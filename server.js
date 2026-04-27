const http = require("http");
const WebSocket = require("ws");

const {
  HEARTBEAT_MS,
  HOST,
  MATCH_TARGET,
  MAX_PLAYERS,
  PORT,
  PUBLIC_DIR,
  RATE_LIMIT_MAX_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  ROOM_CODE_LENGTH,
  STATE_BROADCAST_MS,
  TICK_MS
} = require("./lib/config");
const {
  activePlayerCount,
  advanceRoom,
  createParticipant,
  createRoom,
  fireBanana,
  maybeStartWhenReady,
  removeParticipant,
  serializeState,
  setAim,
  setParticipantName,
  startMatch
} = require("./lib/game-state");
const { broadcast, sanitizeChatText, sanitizeRoomCode, send } = require("./lib/protocol");
const { createStaticHandler } = require("./lib/static-server");

const rooms = new Map();
const socketMeta = new Map();

function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";

  do {
    code = "";
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
  } while (rooms.has(code));

  return code;
}

function getClientRoom(ws) {
  const meta = socketMeta.get(ws);
  return meta ? rooms.get(meta.roomCode) || null : null;
}

function broadcastState(room, now = Date.now()) {
  broadcast(room, "state", { state: serializeState(room) });
  room.dirty = false;
  room.lastBroadcastAt = now;
}

function broadcastStateIfNeeded(room, now, hasMotion = false) {
  if (room.clients.size === 0) {
    return;
  }

  const motionFrameDue = hasMotion && now - room.lastBroadcastAt >= STATE_BROADCAST_MS;
  if (room.dirty || motionFrameDue) {
    broadcastState(room, now);
  }
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
  if (!client) {
    return { room, client: null };
  }

  removeParticipant(room, client.id);

  if (room.participants.size === 0) {
    rooms.delete(room.code);
  }

  return { room, client };
}

function joinRoom(ws, room) {
  if (socketMeta.has(ws)) {
    send(ws, "error", { message: "You are already in a room." });
    return;
  }

  const participantId = `p_${Math.random().toString(36).slice(2, 10)}`;
  const client = createParticipant(room, participantId);
  if (!client) {
    send(ws, "error", { message: `Room ${room.code} is full. Maximum ${room.capacity} players.` });
    return;
  }

  room.clients.set(ws, client);
  socketMeta.set(ws, { roomCode: room.code });

  send(ws, "roomJoined", { code: room.code });
  send(ws, "welcome", {
    participantId,
    slot: client.slot,
    role: client.role,
    targetScore: MATCH_TARGET,
    code: room.code
  });
  broadcast(room, "toast", {
    message: `${client.name} connected${client.role === "spectator" ? " as a spectator" : ""}.`
  });
  maybeStartWhenReady(room);
  broadcastState(room);
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

function allowMessage(ws) {
  const now = Date.now();
  if (!ws.rateLimit || now - ws.rateLimit.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    ws.rateLimit = { windowStartedAt: now, count: 0, warned: false };
  }

  ws.rateLimit.count += 1;
  if (ws.rateLimit.count <= RATE_LIMIT_MAX_MESSAGES) {
    return true;
  }

  if (!ws.rateLimit.warned) {
    ws.rateLimit.warned = true;
    send(ws, "error", { message: "Slow down. Too many messages." });
  }
  return false;
}

function handleMessage(ws, raw) {
  if (!allowMessage(ws)) {
    return;
  }

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

  const isActivePlayer = client.slot !== null && room.game.activeSlots[client.slot] === client.id;

  if (message.type === "aim") {
    if (!isActivePlayer) {
      return;
    }
    if (setAim(room, client.slot, message.angle, message.power)) {
      broadcastState(room);
    }
    return;
  }

  if (message.type === "setName") {
    const name = setParticipantName(room, client.id, message.name);
    if (!name) {
      return;
    }
    broadcast(room, "toast", { message: `${name} is ready.` });
    broadcastState(room);
    return;
  }

  if (message.type === "throw") {
    if (isActivePlayer && fireBanana(room, client.slot)) {
      broadcastState(room);
    }
    return;
  }

  if (message.type === "restart") {
    if (isActivePlayer && activePlayerCount(room) === MAX_PLAYERS && room.game.phase === "matchOver") {
      startMatch(room);
      broadcast(room, "toast", { message: "New match started." });
      broadcastState(room);
    }
    return;
  }

  if (message.type === "chat") {
    handleChat(ws, message.text);
  }
}

function tick() {
  const now = Date.now();
  for (const room of rooms.values()) {
    const hasMotion = advanceRoom(room, now);
    broadcastStateIfNeeded(room, now, hasMotion);
  }
}

const server = http.createServer(createStaticHandler(PUBLIC_DIR));
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("message", (raw) => handleMessage(ws, raw));

  ws.on("close", () => {
    const detached = detachClient(ws);
    if (!detached || !detached.room || !detached.client) {
      return;
    }

    const { room, client } = detached;
    if (room.clients.size > 0) {
      broadcast(room, "toast", { message: `${client.name} disconnected.` });
      maybeStartWhenReady(room);
      broadcastState(room);
    }
  });
});

setInterval(tick, TICK_MS);

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

server.listen(PORT, HOST, () => {
  console.log(`Gorillas server running on http://${HOST}:${PORT}`);
});
