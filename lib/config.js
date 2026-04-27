const path = require("path");

const DEFAULT_PORT = 3001;
const requestedPort = Number.parseInt(process.env.PORT || `${DEFAULT_PORT}`, 10);

module.exports = {
  HOST: process.env.HOST || "0.0.0.0",
  PORT: Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : DEFAULT_PORT,
  PUBLIC_DIR: path.join(__dirname, "..", "public"),
  TICK_MS: 1000 / 60,
  STATE_BROADCAST_MS: 1000 / 30,
  HEARTBEAT_MS: 30000,
  RATE_LIMIT_WINDOW_MS: 1000,
  RATE_LIMIT_MAX_MESSAGES: 40,
  ARENA_WIDTH: 960,
  ARENA_HEIGHT: 540,
  GRAVITY: 0.28,
  MAX_PLAYERS: 2,
  MATCH_TARGET: 3,
  MAX_NAME_LENGTH: 12,
  MAX_WIND: 0.12,
  ROOM_CODE_LENGTH: 4,
  MAX_CHAT_LENGTH: 200,
  ROOM_CAPACITY: 10
};
