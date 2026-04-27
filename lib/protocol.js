const {
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_WIND,
  ROOM_CODE_LENGTH
} = require("./config");

const PROTOCOL_VERSION = 1;
const WS_OPEN = 1;

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

function send(ws, type, payload = {}) {
  if (ws.readyState !== WS_OPEN) {
    return false;
  }
  ws.send(JSON.stringify({ type, ...payload }));
  return true;
}

function broadcast(room, type, payload = {}) {
  for (const ws of room.clients.keys()) {
    send(ws, type, payload);
  }
}

module.exports = {
  PROTOCOL_VERSION,
  clamp,
  finiteOr,
  defaultPlayerName,
  sanitizePlayerName,
  sanitizeRoomCode,
  sanitizeChatText,
  formatWindText,
  send,
  broadcast
};
