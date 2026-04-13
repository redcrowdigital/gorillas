const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  lobbyScreen: document.getElementById("lobby-screen"),
  gameShell: document.getElementById("game-shell"),
  createGame: document.getElementById("create-game"),
  showJoin: document.getElementById("show-join"),
  createPanel: document.getElementById("create-panel"),
  joinForm: document.getElementById("join-form"),
  joinCode: document.getElementById("join-code"),
  lobbyRoomCode: document.getElementById("lobby-room-code"),
  inviteLink: document.getElementById("invite-link"),
  copyInvite: document.getElementById("copy-invite"),
  roomCode: document.getElementById("room-code"),
  roomBanner: document.getElementById("room-banner"),
  bannerRoomCode: document.getElementById("banner-room-code"),
  bannerInviteLink: document.getElementById("banner-invite-link"),
  copyBannerInvite: document.getElementById("copy-banner-invite"),
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
  activeRoster: document.getElementById("active-roster"),
  spectatorRoster: document.getElementById("spectator-roster"),
  queueRoster: document.getElementById("queue-roster"),
  nameModal: document.getElementById("name-modal"),
  nameForm: document.getElementById("name-form"),
  nameInput: document.getElementById("name-input"),
  chatMessages: document.getElementById("chat-messages"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input")
};

const MAX_NAME_LENGTH = 12;
const MAX_WIND = 0.12;

const state = {
  localParticipantId: null,
  localSlot: null,
  localRole: null,
  targetScore: 3,
  snapshot: null,
  connected: false,
  toast: "",
  toastUntil: 0,
  nameSubmitted: false,
  roomCode: "",
  chatMessages: [],
  pendingAutoJoin: new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase() || ""
};

function defaultPlayerName(slot) {
  const numericSlot = Number(slot);
  return Number.isFinite(numericSlot) ? `Player ${numericSlot + 1}` : "Player";
}

function defaultSpectatorName() {
  return "Spectator";
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

  return value.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

function getPlayer(slot) {
  return state.snapshot?.players?.[slot] || null;
}

function getPlayerName(slot) {
  return getPlayer(slot)?.name || defaultPlayerName(slot);
}

function formatWindText(wind) {
  if (wind === 0) {
    return "Calm 0%";
  }

  const direction = wind < 0 ? "Left" : "Right";
  const percent = Math.round((Math.abs(wind) / MAX_WIND) * 100);
  return `${direction} ${percent}%`;
}

function inviteLinkFor(code) {
  return `${window.location.origin}?room=${code}`;
}

function updateRoomUi() {
  const joined = Boolean(state.roomCode);
  ui.lobbyScreen.classList.toggle("hidden", joined);
  ui.gameShell.classList.toggle("hidden", !joined);
  ui.roomCode.textContent = state.roomCode || "----";
  ui.bannerRoomCode.textContent = state.roomCode || "----";

  const inviteLink = state.roomCode ? inviteLinkFor(state.roomCode) : "";
  ui.inviteLink.value = inviteLink;
  ui.bannerInviteLink.value = inviteLink;
  ui.roomBanner.classList.toggle("hidden", !state.roomCode);
}

function updateNameModal() {
  const joined = Boolean(state.roomCode) && Boolean(state.localParticipantId);
  const shouldShow = joined && !state.nameSubmitted;
  ui.nameModal.classList.toggle("visible", shouldShow);
  if (!shouldShow) {
    return;
  }

  ui.nameInput.placeholder = state.localRole === "active"
    ? defaultPlayerName(state.localSlot)
    : defaultSpectatorName();
}

function setToast(message) {
  state.toast = message;
  state.toastUntil = performance.now() + 2200;
}

function appendChatMessage(from, text) {
  state.chatMessages.push({ from, text });
  if (state.chatMessages.length > 100) {
    state.chatMessages.shift();
    ui.chatMessages.firstChild?.remove();
  }

  const item = document.createElement("div");
  item.className = "chat-message";

  const author = document.createElement("strong");
  author.className = "chat-author";
  author.textContent = `${from}: `;

  const body = document.createElement("span");
  body.textContent = text;

  item.append(author, body);
  ui.chatMessages.appendChild(item);
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

function resetChat() {
  state.chatMessages = [];
  ui.chatMessages.textContent = "";
}

function flashCopyButton(button) {
  button.classList.add("copied");
  clearTimeout(button._resetTimer);
  button._resetTimer = setTimeout(() => {
    button.classList.remove("copied");
  }, 1500);
}

function copyInvite(value, button) {
  if (!value) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(() => {
      flashCopyButton(button);
    }).catch(() => {
      fallbackCopy(value, button);
    });
    return;
  }

  fallbackCopy(value, button);
}

function fallbackCopy(value, button) {
  const temp = document.createElement("textarea");
  temp.value = value;
  temp.style.position = "fixed";
  temp.style.opacity = "0";
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand("copy");
    flashCopyButton(button);
  } catch {
    // silent fail — user can select manually
  }
  document.body.removeChild(temp);
}

function showCreatePanel(code) {
  ui.createPanel.classList.remove("hidden");
  ui.joinForm.classList.add("hidden");
  ui.lobbyRoomCode.textContent = code;
  ui.inviteLink.value = inviteLinkFor(code);
}

function wsUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

const socket = new WebSocket(wsUrl());

socket.addEventListener("open", () => {
  state.connected = true;
  ui.connection.textContent = "Connected";

  if (state.pendingAutoJoin) {
    const code = sanitizeRoomCode(state.pendingAutoJoin);
    if (code.length === 4) {
      ui.joinCode.value = code;
      ui.joinForm.classList.remove("hidden");
      send("joinRoom", { code });
    }
  }
});

socket.addEventListener("close", () => {
  state.connected = false;
  ui.connection.textContent = "Disconnected";
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "roomCreated") {
    state.roomCode = message.code;
    showCreatePanel(message.code);
    updateRoomUi();
    return;
  }

  if (message.type === "roomJoined") {
    state.roomCode = message.code;
    updateRoomUi();
    return;
  }

  if (message.type === "welcome") {
    state.localParticipantId = message.participantId || null;
    state.localSlot = message.slot ?? null;
    state.localRole = message.role || (message.slot !== null ? "active" : "spectator");
    state.targetScore = message.targetScore;
    state.roomCode = message.code || state.roomCode;
    ui.playerSlot.textContent = state.localRole === "active"
      ? `You are ${defaultPlayerName(state.localSlot)}`
      : "You are spectating";
    state.nameSubmitted = false;
    updateRoomUi();
    updateNameModal();
    requestAnimationFrame(() => {
      ui.nameInput.focus();
      ui.nameInput.select();
    });
    return;
  }

  if (message.type === "chat") {
    appendChatMessage(message.from, message.text);
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
    state.roomCode = message.state.roomCode || state.roomCode;
    updateRoomUi();
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
  if (!state.snapshot || state.localSlot === null || state.localRole !== "active") {
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

function renderRoster(list, entries, ordered = false) {
  list.textContent = "";
  const items = entries.length ? entries : [{ name: ordered ? "Nobody waiting" : "None" }];
  items.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry.name;
    list.appendChild(item);
  });
}

function updateHud() {
  if (!state.snapshot) {
    return;
  }

  const { game, players, participants = [], queue = [] } = state.snapshot;
  ui.status.textContent = game.status;
  ui.score1.textContent = game.scores[0];
  ui.score2.textContent = game.scores[1];
  ui.score1Label.textContent = players[0].name;
  ui.score2Label.textContent = players[1].name;
  ui.wind.textContent = formatWindText(game.wind);
  ui.turn.textContent = game.phase === "waiting" ? "-" : getPlayerName(game.activePlayer);

  const activeParticipants = participants.filter((participant) => participant.role === "active");
  const spectatorParticipants = participants.filter((participant) => participant.role === "spectator");
  const localParticipant = participants.find((participant) => participant.id === state.localParticipantId) || null;
  renderRoster(ui.activeRoster, activeParticipants);
  renderRoster(ui.spectatorRoster, spectatorParticipants);
  renderRoster(ui.queueRoster, queue, true);

  if (localParticipant) {
    state.localRole = localParticipant.role;
    state.localSlot = localParticipant.slot;
  }

  const myTurn = state.localRole === "active" && state.localSlot === game.activePlayer;
  const ready = players.every((player) => player.connected);
  const isActivePlayer = state.localRole === "active" && state.localSlot !== null;
  const canThrow = ready && isActivePlayer && myTurn && game.phase === "aiming";
  const canRestart = isActivePlayer && ready && game.phase === "matchOver";

  if (state.localRole === "active" && localParticipant) {
    ui.playerSlot.textContent = `You are ${localParticipant.name}`;
  } else {
    ui.playerSlot.textContent = "You are spectating";
  }

  ui.throw.disabled = !canThrow;
  ui.angle.disabled = !canThrow;
  ui.power.disabled = !canThrow;
  ui.restart.disabled = !canRestart;
}

ui.createGame.addEventListener("click", () => {
  resetChat();
  send("createRoom");
});

ui.showJoin.addEventListener("click", () => {
  ui.joinForm.classList.remove("hidden");
  ui.createPanel.classList.add("hidden");
  ui.joinCode.focus();
  ui.joinCode.select();
});

ui.joinCode.addEventListener("input", () => {
  ui.joinCode.value = sanitizeRoomCode(ui.joinCode.value);
});

ui.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = sanitizeRoomCode(ui.joinCode.value);
  ui.joinCode.value = code;
  if (code.length !== 4) {
    setToast("Enter a valid 4-letter room code.");
    return;
  }

  resetChat();
  send("joinRoom", { code });
});

ui.copyInvite.addEventListener("click", () => {
  copyInvite(ui.inviteLink.value, ui.copyInvite);
});

ui.copyBannerInvite.addEventListener("click", () => {
  copyInvite(ui.bannerInviteLink.value, ui.copyBannerInvite);
});

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
  const fallbackSlot = state.localSlot ?? 0;
  const name = sanitizePlayerName(ui.nameInput.value, fallbackSlot);
  ui.nameInput.value = name;
  state.nameSubmitted = true;
  updateNameModal();
  send("setName", { name });
});

ui.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = ui.chatInput.value.trim().slice(0, 200);
  if (!text || !state.roomCode) {
    return;
  }

  ui.chatInput.value = "";
  send("chat", { text });
});

window.addEventListener("keydown", (event) => {
  if (event.target === ui.chatInput || event.target === ui.joinCode || event.target === ui.nameInput) {
    return;
  }

  if (!state.snapshot || state.localSlot === null || state.localRole !== "active") {
    return;
  }

  const canAdjust =
    state.snapshot.game.phase === "aiming" &&
    state.snapshot.game.activePlayer === state.localSlot;

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

  if (!state.roomCode) {
    ctx.fillStyle = "#f0e6c8";
    ctx.font = "22px Courier New";
    ctx.textAlign = "center";
    ctx.fillText("Join or create a room to start.", canvas.width / 2, canvas.height / 2);
    return;
  }

  if (!state.snapshot) {
    ctx.fillStyle = "#f0e6c8";
    ctx.font = "22px Courier New";
    ctx.textAlign = "center";
    ctx.fillText("Connecting to room...", canvas.width / 2, canvas.height / 2);
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

updateRoomUi();
render();
