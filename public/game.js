const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  connection: document.getElementById("connection"),
  status: document.getElementById("status"),
  playerSlot: document.getElementById("player-slot"),
  angle: document.getElementById("angle"),
  angleValue: document.getElementById("angle-value"),
  power: document.getElementById("power"),
  powerValue: document.getElementById("power-value"),
  throw: document.getElementById("throw"),
  restart: document.getElementById("restart"),
  score1: document.getElementById("score-p1"),
  score2: document.getElementById("score-p2"),
  score1Label: document.querySelector('.scorecard[data-player="1"] .label'),
  score2Label: document.querySelector('.scorecard[data-player="2"] .label'),
  wind: document.getElementById("wind"),
  turn: document.getElementById("turn"),
  nameModal: document.getElementById("name-modal"),
  nameForm: document.getElementById("name-form"),
  nameInput: document.getElementById("name-input")
};

const MAX_NAME_LENGTH = 12;
const MAX_WIND = 0.5;

const state = {
  localSlot: null,
  targetScore: 3,
  snapshot: null,
  connected: false,
  toast: "",
  toastUntil: 0,
  nameSubmitted: false
};

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

function getPlayer(slot) {
  return state.snapshot?.players?.[slot] || null;
}

function getPlayerName(slot) {
  return getPlayer(slot)?.name || defaultPlayerName(slot);
}

function updateNameModal() {
  const shouldShow = state.localSlot !== null && !state.nameSubmitted;
  ui.nameModal.classList.toggle("visible", shouldShow);
  if (!shouldShow) {
    return;
  }

  ui.nameInput.placeholder = defaultPlayerName(state.localSlot);
}

function setToast(message) {
  state.toast = message;
  state.toastUntil = performance.now() + 2200;
}

function wsUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

const socket = new WebSocket(wsUrl());

socket.addEventListener("open", () => {
  state.connected = true;
  ui.connection.textContent = "Connected";
});

socket.addEventListener("close", () => {
  state.connected = false;
  ui.connection.textContent = "Disconnected";
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "welcome") {
    state.localSlot = message.slot;
    state.targetScore = message.targetScore;
    ui.playerSlot.textContent = `You are ${defaultPlayerName(message.slot)}`;
    updateNameModal();
    requestAnimationFrame(() => {
      ui.nameInput.focus();
      ui.nameInput.select();
    });
    return;
  }

  if (message.type === "toast") {
    setToast(message.message);
    return;
  }

  if (message.type === "error") {
    setToast(message.message);
    ui.connection.textContent = "Unable to join";
    return;
  }

  if (message.type === "state") {
    state.snapshot = message.state;
    if (state.localSlot !== null) {
      ui.playerSlot.textContent = `You are ${getPlayerName(state.localSlot)}`;
    }
    syncControls();
    updateHud();
    updateNameModal();
  }
});

function send(type, payload = {}) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({ type, ...payload }));
}

function syncControls() {
  if (!state.snapshot || state.localSlot === null) {
    return;
  }
  const aim = state.snapshot.game.aim[state.localSlot];
  if (!aim) {
    return;
  }

  if (document.activeElement !== ui.angle) {
    ui.angle.value = aim.angle;
  }
  if (document.activeElement !== ui.power) {
    ui.power.value = aim.power;
  }
  ui.angleValue.textContent = `${ui.angle.value}\u00b0`;
  ui.powerValue.textContent = ui.power.value;
}

function updateHud() {
  if (!state.snapshot) {
    return;
  }

  const { game, players } = state.snapshot;
  ui.status.textContent = game.status;
  ui.score1.textContent = game.scores[0];
  ui.score2.textContent = game.scores[1];
  ui.score1Label.textContent = players[0].name;
  ui.score2Label.textContent = players[1].name;
  ui.wind.textContent = `${game.wind > 0 ? ">" : game.wind < 0 ? "<" : "-"} ${Math.abs(game.wind).toFixed(3)}`;
  ui.turn.textContent = game.phase === "waiting" ? "-" : getPlayerName(game.activePlayer);

  const myTurn = state.localSlot === game.activePlayer;
  const ready = players.every((player) => player.connected);
  const canThrow = ready && myTurn && game.phase === "aiming" && state.nameSubmitted;

  ui.throw.disabled = !canThrow;
  ui.angle.disabled = !canThrow;
  ui.power.disabled = !canThrow;
  ui.restart.disabled = !ready;
}

ui.angle.addEventListener("input", () => {
  ui.angleValue.textContent = `${ui.angle.value}\u00b0`;
  send("aim", { angle: Number(ui.angle.value), power: Number(ui.power.value) });
});

ui.power.addEventListener("input", () => {
  ui.powerValue.textContent = ui.power.value;
  send("aim", { angle: Number(ui.angle.value), power: Number(ui.power.value) });
});

ui.throw.addEventListener("click", () => {
  send("throw");
});

ui.restart.addEventListener("click", () => {
  send("restart");
});

ui.nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.localSlot === null) {
    return;
  }

  const name = sanitizePlayerName(ui.nameInput.value, state.localSlot);
  ui.nameInput.value = name;
  state.nameSubmitted = true;
  updateNameModal();
  send("setName", { name });
});

window.addEventListener("keydown", (event) => {
  if (!state.snapshot || state.localSlot === null) {
    return;
  }

  const canAdjust =
    state.snapshot.game.phase === "aiming" &&
    state.snapshot.game.activePlayer === state.localSlot &&
    state.nameSubmitted;

  if (!canAdjust) {
    return;
  }

  let handled = true;

  if (event.key === "ArrowUp") {
    ui.angle.value = Math.min(359, Number(ui.angle.value) + 1);
  } else if (event.key === "ArrowDown") {
    ui.angle.value = Math.max(0, Number(ui.angle.value) - 1);
  } else if (event.key === "ArrowRight") {
    ui.power.value = Math.min(100, Number(ui.power.value) + 1);
  } else if (event.key === "ArrowLeft") {
    ui.power.value = Math.max(10, Number(ui.power.value) - 1);
  } else if (event.key === " " || event.key === "Enter") {
    send("throw");
  } else {
    handled = false;
  }

  if (handled) {
    event.preventDefault();
    ui.angleValue.textContent = `${ui.angle.value}\u00b0`;
    ui.powerValue.textContent = ui.power.value;
    send("aim", { angle: Number(ui.angle.value), power: Number(ui.power.value) });
  }
});

function drawSky(width, height) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#1a2442");
  sky.addColorStop(0.45, "#11162a");
  sky.addColorStop(1, "#06070d");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 90; i += 1) {
    const x = (i * 137) % width;
    const y = (i * 53) % Math.floor(height * 0.55);
    const alpha = 0.25 + ((i * 17) % 100) / 400;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = "#f8e7a2";
  ctx.beginPath();
  ctx.arc(width - 120, 88, 24, 0, Math.PI * 2);
  ctx.fill();
}

function drawBuildings(city) {
  for (const building of city) {
    ctx.save();
    ctx.fillStyle = building.color;
    ctx.fillRect(building.x, building.topY, building.width, building.height);

    for (const window of building.windows) {
      ctx.fillStyle = window.lit ? "#ffd36a" : "#2e3750";
      ctx.fillRect(window.x, window.y, 6, 10);
    }

    ctx.globalCompositeOperation = "destination-out";
    for (const hole of building.holes) {
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.strokeRect(building.x + 0.5, building.topY + 0.5, building.width - 1, building.height - 1);
  }
}

function drawGorilla(gorilla, activePlayer) {
  if (gorilla.alive === false) {
    return;
  }

  const isActive = gorilla.slot === activePlayer;
  const armOffset = gorilla.pose === "throw" ? 18 : 10;
  const facing = gorilla.slot === 0 ? 1 : -1;

  ctx.save();
  ctx.translate(gorilla.x, gorilla.y);
  ctx.fillStyle = isActive ? "#ff9f43" : "#d68b34";

  ctx.fillRect(-10, -16, 20, 18);
  ctx.fillRect(-14, -6, 28, 14);
  ctx.fillRect(-10, 8, 6, 12);
  ctx.fillRect(4, 8, 6, 12);
  ctx.fillRect(-18, -2, 8, 22);
  ctx.fillRect(10, -2, 8, 22);

  ctx.fillStyle = "#101114";
  ctx.fillRect(-4, -12, 3, 3);
  ctx.fillRect(2, -12, 3, 3);

  ctx.strokeStyle = "#d68b34";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-12 * facing, -8);
  ctx.lineTo((-12 - armOffset) * facing, -24);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(12 * facing, -6);
  ctx.lineTo((12 + 8) * facing, 8);
  ctx.stroke();

  // Player label above head
  const label = getPlayerName(gorilla.slot);
  ctx.fillStyle = isActive ? "#ffe27a" : "#93a0c4";
  ctx.font = "bold 11px Courier New";
  ctx.textAlign = "center";
  ctx.fillText(label, 0, -28);
  ctx.restore();
}

function drawBanana(banana) {
  if (!banana) {
    return;
  }

  ctx.save();
  ctx.translate(banana.x, banana.y);
  ctx.rotate(banana.rotation);
  ctx.strokeStyle = "#ffe27a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 6, Math.PI * 0.25, Math.PI * 1.35);
  ctx.stroke();
  ctx.restore();
}

function drawExplosion(explosion) {
  if (!explosion) {
    return;
  }

  const pulse = 1 + (28 - explosion.ttl) * 0.02;
  const radius = explosion.radius * pulse;
  const burst = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, radius);
  burst.addColorStop(0, "rgba(255, 248, 208, 0.95)");
  burst.addColorStop(0.4, "rgba(255, 179, 71, 0.9)");
  burst.addColorStop(0.8, "rgba(255, 83, 59, 0.4)");
  burst.addColorStop(1, "rgba(255, 83, 59, 0)");
  ctx.fillStyle = burst;
  ctx.beginPath();
  ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawWindIndicator(game, width) {
  const centerX = width / 2;
  const y = 36;
  const maxMagnitude = 120;
  const magnitude = Math.min(maxMagnitude, (Math.abs(game.wind) / 0.12) * maxMagnitude);
  const direction = game.wind >= 0 ? 1 : -1;

  ctx.fillStyle = "#d6dfef";
  ctx.font = "16px Courier New";
  ctx.textAlign = "center";
  ctx.fillText("WIND", centerX, y - 10);

  ctx.strokeStyle = "#9cc7ff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(centerX - 40 * direction, y + 6);
  ctx.lineTo(centerX + magnitude * direction, y + 6);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX + magnitude * direction, y + 6);
  ctx.lineTo(centerX + (magnitude - 10) * direction, y + 1);
  ctx.lineTo(centerX + (magnitude - 10) * direction, y + 11);
  ctx.closePath();
  ctx.fillStyle = "#9cc7ff";
  ctx.fill();
}

function drawOverlay(snapshot) {
  if (!snapshot) {
    return;
  }

  const { game, players } = snapshot;
  if (game.phase === "waiting") {
    ctx.fillStyle = "rgba(4, 6, 12, 0.72)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f0e6c8";
    ctx.textAlign = "center";
    ctx.font = "28px Courier New";
    ctx.fillText("WAITING FOR TWO PLAYERS", canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = "18px Courier New";
    ctx.fillStyle = "#93a0c4";
    const connected = players.filter((player) => player.connected).length;
    ctx.fillText(`${connected}/2 connected`, canvas.width / 2, canvas.height / 2 + 26);
  }

  if (game.phase === "matchOver") {
    ctx.fillStyle = "rgba(4, 6, 12, 0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffcf6a";
    ctx.font = "34px Courier New";
    ctx.textAlign = "center";
    ctx.fillText(`${getPlayerName(game.matchWinner)} WINS`, canvas.width / 2, 140);
  }

  if (state.toast && performance.now() < state.toastUntil) {
    ctx.fillStyle = "rgba(10, 14, 24, 0.9)";
    ctx.fillRect(canvas.width / 2 - 180, 24, 360, 34);
    ctx.strokeStyle = "#ffb347";
    ctx.strokeRect(canvas.width / 2 - 180.5, 24.5, 361, 34);
    ctx.fillStyle = "#f0e6c8";
    ctx.font = "16px Courier New";
    ctx.textAlign = "center";
    ctx.fillText(state.toast, canvas.width / 2, 46);
  }
}

function render() {
  requestAnimationFrame(render);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSky(canvas.width, canvas.height);

  if (!state.snapshot) {
    ctx.fillStyle = "#f0e6c8";
    ctx.font = "22px Courier New";
    ctx.textAlign = "center";
    ctx.fillText("Connecting to server...", canvas.width / 2, canvas.height / 2);
    return;
  }

  const { game } = state.snapshot;
  drawBuildings(game.city);
  drawWindIndicator(game, canvas.width);
  for (const gorilla of game.gorillas) {
    drawGorilla(gorilla, game.activePlayer);
  }
  drawBanana(game.banana);
  drawExplosion(game.explosion);
  drawOverlay(state.snapshot);
}

render();
