const {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  GRAVITY,
  MATCH_TARGET,
  MAX_PLAYERS,
  MAX_WIND,
  ROOM_CAPACITY
} = require("./config");
const {
  PROTOCOL_VERSION,
  clamp,
  defaultPlayerName,
  finiteOr,
  formatWindText,
  sanitizePlayerName
} = require("./protocol");

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function markRoomDirty(room) {
  room.dirty = true;
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
    nextRoundAt: null,
    activeSlots: [null, null],
    queue: []
  };
}

function createRoom(code) {
  const room = {
    code,
    game: createRoomState(),
    clients: new Map(),
    participants: new Map(),
    queue: [],
    capacity: ROOM_CAPACITY,
    playerNames: Array.from({ length: MAX_PLAYERS }, (_, slot) => defaultPlayerName(slot)),
    dirty: true,
    lastBroadcastAt: 0
  };

  createFreshRound(room, false);
  room.game.phase = "waiting";
  room.game.status = "Waiting for players...";
  markRoomDirty(room);
  return room;
}

function getPlayerName(room, slot) {
  return room.playerNames[slot] || defaultPlayerName(slot);
}

function getParticipant(room, id) {
  return id ? room.participants.get(id) || null : null;
}

function getActiveParticipants(room) {
  return room.game.activeSlots
    .map((id) => getParticipant(room, id))
    .filter(Boolean);
}

function updateParticipantRoles(room) {
  const activeIds = room.game.activeSlots.filter(Boolean);
  for (const participant of room.participants.values()) {
    const slot = room.game.activeSlots.findIndex((participantId) => participantId === participant.id);
    participant.role = activeIds.includes(participant.id) ? "active" : "spectator";
    participant.slot = slot === -1 ? null : slot;
  }
}

function syncPlayerNamesFromActiveSlots(room) {
  room.game.activeSlots.forEach((participantId, slot) => {
    const participant = getParticipant(room, participantId);
    room.playerNames[slot] = participant ? participant.name : defaultPlayerName(slot);
  });
}

function promoteQueuedParticipant(room) {
  while (room.queue.length > 0) {
    const nextId = room.queue.shift();
    const participant = getParticipant(room, nextId);
    if (participant) {
      return participant;
    }
  }
  return null;
}

function fillActiveSlots(room) {
  let changed = false;

  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) {
    const currentId = room.game.activeSlots[slot];
    if (currentId && getParticipant(room, currentId)) {
      continue;
    }

    const promoted = promoteQueuedParticipant(room);
    const nextId = promoted ? promoted.id : null;
    if (room.game.activeSlots[slot] !== nextId) {
      room.game.activeSlots[slot] = nextId;
      changed = true;
    }
  }

  updateParticipantRoles(room);
  syncPlayerNamesFromActiveSlots(room);

  if (changed) {
    markRoomDirty(room);
  }
}

function participantForSlot(room, slot) {
  return getParticipant(room, room.game.activeSlots[slot]);
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
  markRoomDirty(room);
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
    protocolVersion: PROTOCOL_VERSION,
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    roomCode: room.code,
    players: Array.from({ length: MAX_PLAYERS }, (_, slot) => {
      const participant = participantForSlot(room, slot);
      return {
        slot,
        connected: Boolean(participant),
        id: participant?.id || null,
        name: participant?.name || defaultPlayerName(slot)
      };
    }),
    participants: [...room.participants.values()].map((participant) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      slot: participant.slot
    })),
    queue: room.queue
      .map((participantId) => getParticipant(room, participantId))
      .filter(Boolean)
      .map((participant) => ({ id: participant.id, name: participant.name })),
    game: room.game
  };
}

function activePlayerCount(room) {
  return getActiveParticipants(room).length;
}

function createParticipant(room, participantId) {
  if (room.participants.size >= room.capacity) {
    return null;
  }

  const activeSlot = room.game.activeSlots.findIndex((id) => id === null);
  const role = activeSlot !== -1 ? "active" : "spectator";
  const slot = role === "active" ? activeSlot : null;
  const defaultName = role === "active" ? getPlayerName(room, slot) : `Spectator ${room.participants.size + 1}`;
  const participant = { id: participantId, slot, role, name: defaultName };

  room.participants.set(participantId, participant);
  if (role === "active") {
    room.game.activeSlots[slot] = participantId;
    room.playerNames[slot] = participant.name;
  } else {
    room.queue.push(participantId);
  }

  fillActiveSlots(room);
  markRoomDirty(room);
  return participant;
}

function removeParticipant(room, participantId) {
  const participant = getParticipant(room, participantId);
  if (!participant) {
    return null;
  }

  room.participants.delete(participantId);
  room.queue = room.queue.filter((queuedId) => queuedId !== participantId);
  room.game.activeSlots = room.game.activeSlots.map((slotId) => (slotId === participantId ? null : slotId));
  fillActiveSlots(room);
  markRoomDirty(room);
  return participant;
}

function startMatch(room) {
  room.game.activePlayer = Math.random() > 0.5 ? 0 : 1;
  createFreshRound(room, false);
  room.game.activeSlots = room.game.activeSlots.map((id) => (getParticipant(room, id) ? id : null));
  syncPlayerNamesFromActiveSlots(room);
  room.game.phase = "aiming";
  room.game.status = `${getPlayerName(room, room.game.activePlayer)}'s turn`;
  markRoomDirty(room);
}

function maybeStartWhenReady(room) {
  fillActiveSlots(room);

  if (activePlayerCount(room) === MAX_PLAYERS) {
    if (room.game.phase === "waiting") {
      startMatch(room);
    } else {
      reconcileGameState(room);
    }
  } else {
    reconcileGameState(room);
  }
  markRoomDirty(room);
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

  markRoomDirty(room);
}

function rotateWinnerStaysOn(room, winnerSlot) {
  if (activePlayerCount(room) < MAX_PLAYERS) {
    return;
  }

  const loserSlot = winnerSlot === 0 ? 1 : 0;
  const winnerId = room.game.activeSlots[winnerSlot];
  const loserId = room.game.activeSlots[loserSlot];

  if (!winnerId || !loserId) {
    return;
  }

  room.queue.push(loserId);

  const nextParticipant = promoteQueuedParticipant(room);
  room.game.activeSlots[winnerSlot] = winnerId;
  room.game.activeSlots[loserSlot] = nextParticipant ? nextParticipant.id : loserId;

  updateParticipantRoles(room);
  syncPlayerNamesFromActiveSlots(room);
  markRoomDirty(room);
}

function reconcileGameState(room) {
  fillActiveSlots(room);

  const { game } = room;
  if (activePlayerCount(room) < MAX_PLAYERS) {
    game.phase = "waiting";
    game.banana = null;
    game.explosion = null;
    game.status = activePlayerCount(room) === 1 ? "Waiting for one more player..." : "Waiting for players...";
    markRoomDirty(room);
    return;
  }

  if (game.activePlayer >= MAX_PLAYERS || !participantForSlot(room, game.activePlayer)) {
    game.activePlayer = 0;
  }

  refreshStatusText(room);
}

function setAim(room, slot, angle, power) {
  const current = room.game.aim[slot];
  if (!current) {
    return false;
  }

  const nextAngle = clamp(finiteOr(Number(angle), current.angle), 0, 359);
  const nextPower = clamp(finiteOr(Number(power), current.power), 10, 100);
  const changed = current.angle !== nextAngle || current.power !== nextPower;
  current.angle = nextAngle;
  current.power = nextPower;

  if (changed) {
    markRoomDirty(room);
  }
  return true;
}

function setParticipantName(room, participantId, value) {
  const participant = getParticipant(room, participantId);
  if (!participant) {
    return null;
  }

  const fallbackSlot = participant.slot ?? 0;
  const name = sanitizePlayerName(value, fallbackSlot);
  participant.name = name;
  if (participant.slot !== null) {
    room.playerNames[participant.slot] = name;
  }
  refreshStatusText(room);
  markRoomDirty(room);
  return name;
}

function fireBanana(room, slot) {
  const { game } = room;
  if (game.phase !== "aiming" || game.activePlayer !== slot || activePlayerCount(room) < MAX_PLAYERS) {
    return false;
  }

  const thrower = game.gorillas[slot];
  if (!thrower || !gorillaAlive(thrower)) {
    return false;
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
  markRoomDirty(room);
  return true;
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
    markRoomDirty(room);
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
    markRoomDirty(room);
  }
}

function advanceRoom(room, now = Date.now()) {
  const { game } = room;
  const hadMotion = game.phase === "projectile" || Boolean(game.explosion);

  if (game.phase === "projectile") {
    updateProjectile(room);
  }

  updateExplosion(room);

  for (const gorilla of game.gorillas) {
    if (gorilla.pose === "throw" && game.phase !== "projectile") {
      gorilla.pose = "idle";
      markRoomDirty(room);
    }
  }

  if (game.phase === "roundOver" && game.nextRoundAt && now >= game.nextRoundAt) {
    if (game.roundWinner !== null && room.queue.length > 0) {
      rotateWinnerStaysOn(room, game.roundWinner);
    }
    createFreshRound(room, true);
    reconcileGameState(room);
  }

  return hadMotion || game.phase === "projectile" || Boolean(game.explosion);
}

module.exports = {
  activePlayerCount,
  advanceRoom,
  createParticipant,
  createRoom,
  fireBanana,
  getParticipant,
  makeExplosion,
  maybeStartWhenReady,
  markRoomDirty,
  removeParticipant,
  rotateWinnerStaysOn,
  serializeState,
  setAim,
  setParticipantName,
  startMatch
};
