const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createParticipant,
  createRoom,
  makeExplosion,
  maybeStartWhenReady,
  removeParticipant,
  rotateWinnerStaysOn,
  serializeState,
  setAim
} = require("../lib/game-state");
const {
  PROTOCOL_VERSION,
  sanitizeChatText,
  sanitizePlayerName,
  sanitizeRoomCode
} = require("../lib/protocol");

test("sanitizes protocol inputs", () => {
  assert.equal(sanitizeRoomCode(" a1b-cD "), "ABCD");
  assert.equal(sanitizeRoomCode(null), "");
  assert.equal(sanitizePlayerName("  LongPlayerName  ", 0), "LongPlayerNa");
  assert.equal(sanitizePlayerName("   ", 1), "Player 2");
  assert.equal(sanitizeChatText(` ${"x".repeat(250)} `).length, 200);
});

test("assigns two active players and queues later participants", () => {
  const room = createRoom("TEST");

  const first = createParticipant(room, "p1");
  const second = createParticipant(room, "p2");
  const third = createParticipant(room, "p3");
  maybeStartWhenReady(room);

  assert.equal(first.role, "active");
  assert.equal(first.slot, 0);
  assert.equal(second.role, "active");
  assert.equal(second.slot, 1);
  assert.equal(third.role, "spectator");
  assert.deepEqual(room.game.activeSlots, ["p1", "p2"]);
  assert.deepEqual(room.queue, ["p3"]);
  assert.equal(room.game.phase, "aiming");
});

test("promotes queued participant when active player disconnects", () => {
  const room = createRoom("TEST");
  createParticipant(room, "p1");
  createParticipant(room, "p2");
  createParticipant(room, "p3");

  const removed = removeParticipant(room, "p2");

  assert.equal(removed.id, "p2");
  assert.deepEqual(room.game.activeSlots, ["p1", "p3"]);
  assert.equal(room.participants.get("p3").role, "active");
  assert.equal(room.participants.get("p3").slot, 1);
  assert.deepEqual(room.queue, []);
});

test("winner stays active and loser rotates to the queue", () => {
  const room = createRoom("TEST");
  createParticipant(room, "p1");
  createParticipant(room, "p2");
  createParticipant(room, "p3");

  rotateWinnerStaysOn(room, 0);

  assert.deepEqual(room.game.activeSlots, ["p1", "p3"]);
  assert.equal(room.participants.get("p1").role, "active");
  assert.equal(room.participants.get("p2").role, "spectator");
  assert.equal(room.participants.get("p3").role, "active");
  assert.deepEqual(room.queue, ["p2"]);
});

test("clamps aim input", () => {
  const room = createRoom("TEST");
  createParticipant(room, "p1");

  assert.equal(setAim(room, 0, 800, -10), true);
  assert.deepEqual(room.game.aim[0], { angle: 359, power: 10 });
});

test("explosion scoring moves room into round over state", () => {
  const room = createRoom("TEST");
  createParticipant(room, "p1");
  createParticipant(room, "p2");
  maybeStartWhenReady(room);

  makeExplosion(room, room.game.gorillas[1].x, room.game.gorillas[1].y, 34, 1);

  assert.equal(room.game.scores[0], 1);
  assert.equal(room.game.roundWinner, 0);
  assert.equal(room.game.phase, "roundOver");
});

test("serialized snapshots carry protocol version", () => {
  const room = createRoom("TEST");
  const snapshot = serializeState(room);

  assert.equal(snapshot.protocolVersion, PROTOCOL_VERSION);
  assert.equal(snapshot.roomCode, "TEST");
});
