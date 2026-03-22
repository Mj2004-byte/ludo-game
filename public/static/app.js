const socket = io();

const $ = (id) => document.getElementById(id);

let mySocketId = null;
let roomPassword = null;
let myIndex = -1;
let lobbyDeadlineMs = null;
let lobbyCountdownTimer = null;
let lastRoomState = null;

if (window.WebRtcGame) {
  WebRtcGame.init(socket);
}

function clearLobbyCountdownTimer() {
  if (lobbyCountdownTimer) {
    clearInterval(lobbyCountdownTimer);
    lobbyCountdownTimer = null;
  }
}

function updateLobbyCountdownDisplay() {
  const el = $("lobby-countdown");
  if (!el) return;
  if (lobbyDeadlineMs == null) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const sec = Math.max(0, Math.ceil((lobbyDeadlineMs - Date.now()) / 1000));
  el.hidden = false;
  el.textContent = `Auto-start in ${sec}s — empty seats will be filled with AI`;
}

socket.on("connect", () => {
  mySocketId = socket.id;
});

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-content").forEach((el) => {
      el.classList.toggle("active", el.id === `form-${tab}`);
    });
  });
});

function syncMuteButtons(on) {
  const t = on ? "Mute mic" : "Unmute mic";
  const b = $("btn-mute");
  const g = $("btn-mute-game");
  if (b) b.textContent = t;
  if (g) g.textContent = t;
}

function wireMute(btn) {
  btn?.addEventListener("click", () => {
    if (!window.WebRtcGame) return;
    const micOn = WebRtcGame.toggleMic();
    syncMuteButtons(micOn);
  });
}

wireMute($("btn-mute"));
wireMute($("btn-mute-game"));

function mountVideos(mode) {
  const vs = $("video-stage");
  const lobbyA = $("video-lobby-anchor");
  const grid = $("ludo-grid-root");
  const board = grid?.querySelector(".board-center");
  if (!vs) return;
  if (mode === "game" && grid && board) {
    grid.insertBefore(vs, board);
    vs.classList.add("video-corners");
    vs.classList.remove("video-strip");
  } else if (lobbyA) {
    lobbyA.appendChild(vs);
    vs.classList.add("video-strip");
    vs.classList.remove("video-corners");
  }
}

function updateTurnHighlight(state) {
  document.querySelectorAll(".video-face-wrap").forEach((el) => {
    const i = Number(el.getAttribute("data-player"));
    const on = state.phase === "playing" && Number.isInteger(i) && i === state.turn;
    el.classList.toggle("is-turn", on);
  });
}

function updateVideoLabels(state) {
  if (!state.players) return;
  state.players.forEach((p, i) => {
    const lab = document.querySelector(`.video-face-wrap[data-player="${i}"] .video-label`);
    if (lab) lab.textContent = p.name?.slice(0, 14) || ["Red", "Green", "Yellow", "Blue"][i];
  });
}

function showVideoStage(on) {
  const vs = $("video-stage");
  if (vs) vs.classList.toggle("hidden", !on);
}

function showError(elId, msg) {
  const el = $(elId);
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

$("form-create").addEventListener("submit", (e) => {
  e.preventDefault();
  showError("lobby-error", "");
  const name = $("create-name").value.trim() || "Player";
  socket.emit("room:create", { name }, (res) => {
    if (res?.error) {
      showError("lobby-error", res.error);
      return;
    }
    roomPassword = res.password;
    $("room-id-display").textContent = res.roomId;
    $("room-pass-display").textContent = res.password;
    $("panel-lobby").classList.add("hidden");
    $("panel-room").classList.remove("hidden");
  });
});

$("form-join").addEventListener("submit", (e) => {
  e.preventDefault();
  showError("lobby-error", "");
  const name = $("join-name").value.trim() || "Player";
  const roomId = $("join-room").value.trim().toUpperCase();
  const password = $("join-pass").value.trim();
  socket.emit("room:join", { roomId, password, name }, (res) => {
    if (res?.error) {
      showError("lobby-error", res.error);
      return;
    }
    roomPassword = password;
    $("room-id-display").textContent = res.roomId;
    $("room-pass-display").textContent = "••••";
    $("panel-lobby").classList.add("hidden");
    $("panel-room").classList.remove("hidden");
  });
});

$("copy-id").addEventListener("click", () => {
  const t = $("room-id-display").textContent;
  navigator.clipboard?.writeText(t);
});

$("copy-pass").addEventListener("click", () => {
  const t = roomPassword || $("room-pass-display").textContent;
  if (t && t !== "••••") navigator.clipboard?.writeText(String(t));
});

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderRoom(state) {
  if (state.phase === "playing" || state.phase === "finished") {
    mountVideos("game");
    document.body.classList.add("game-active");
  } else if (state.phase === "lobby") {
    mountVideos("lobby");
    document.body.classList.remove("game-active");
  }

  const list = $("player-list");
  list.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    const tag = p.isAI ? ` <span class="ai-tag">AI</span>` : "";
    li.innerHTML = `<span class="dot ${p.color}"></span><span>${escapeHtml(p.name)}</span>${tag}`;
    list.appendChild(li);
  });

  const isHost = socket.connected && state.hostSocketId === socket.id;
  const btn = $("btn-start");
  btn.hidden = state.phase !== "lobby" || !isHost;
  btn.disabled = false;
  if (!btn.hidden && isHost) {
    btn.title = "Skip the 20s wait and start immediately (AI fills empty seats).";
  } else {
    btn.removeAttribute("title");
  }
  btn.onclick = () => {
    showError("room-error", "");
    socket.emit("game:start", {}, (res) => {
      if (res?.error) showError("room-error", res.error);
    });
  };

  if (state.phase === "playing" || state.phase === "finished") {
    $("panel-room").classList.add("hidden");
    $("panel-game").classList.remove("hidden");
    renderGame(state);
  } else {
    $("panel-game").classList.add("hidden");
  }
}

function renderGame(state) {
  const names = ["Red", "Green", "Yellow", "Blue"];
  const turnName =
    state.players[state.turn] != null
      ? `${state.players[state.turn].name} (${names[state.turn] || ""})`
      : "—";

  $("turn-label").textContent =
    state.phase === "finished" ? "Game over" : `Turn: ${turnName}`;

  const dice = state.lastDice;
  $("dice-label").textContent =
    state.diceRolled && dice != null ? `🎲 ${dice}` : "🎲 —";

  const myTurn = state.phase === "playing" && state.turn === myIndex;
  $("btn-roll").disabled = !myTurn || state.diceRolled || state.phase !== "playing";
  $("btn-roll").onclick = () => {
    showError("game-error", "");
    socket.emit("game:roll", (res) => {
      if (res?.error) showError("game-error", res.error);
    });
  };

  if (window.LudoBoard) {
    LudoBoard.render(state);
  }
  updateTurnHighlight(state);
  updateVideoLabels(state);

  const pc = $("piece-controls");
  pc.innerHTML = "";
  if (myIndex < 0 || !state.players[myIndex]) return;
  const p = state.players[myIndex];
  p.pieces.forEach((pos, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `piece ${p.color}`;
    b.textContent = pos === 0 ? "H" : pos === 57 ? "✓" : String(pos);
    const canClick =
      myTurn && state.diceRolled && state.phase === "playing" && pos < 57;
    b.disabled = !canClick;
    b.addEventListener("click", () => {
      showError("game-error", "");
      socket.emit("game:move", { pieceIndex: idx }, (res) => {
        if (res?.error) showError("game-error", res.error);
      });
    });
    pc.appendChild(b);
  });

  const msg = $("game-msg");
  if (state.phase === "finished" && state.winner != null && state.players[state.winner]) {
    msg.textContent = `Winner: ${state.players[state.winner].name}`;
  } else if (state.gameNotice) {
    msg.textContent = state.gameNotice;
  } else {
    msg.textContent = "";
  }
}

window.addEventListener("resize", () => {
  if (lastRoomState && (lastRoomState.phase === "playing" || lastRoomState.phase === "finished") && window.LudoBoard) {
    LudoBoard.render(lastRoomState);
  }
});

socket.on("room:state", (state) => {
  lastRoomState = state;
  if (typeof state.myIndex === "number") myIndex = state.myIndex;
  mySocketId = socket.id;
  lobbyDeadlineMs = state.lobbyDeadlineMs ?? null;

  if (state.phase === "lobby") {
    $("panel-lobby").classList.add("hidden");
    $("panel-room").classList.remove("hidden");
    clearLobbyCountdownTimer();
    if (lobbyDeadlineMs != null) {
      updateLobbyCountdownDisplay();
      lobbyCountdownTimer = setInterval(updateLobbyCountdownDisplay, 500);
    }
  } else {
    clearLobbyCountdownTimer();
    lobbyDeadlineMs = null;
    updateLobbyCountdownDisplay();
  }

  renderRoom(state);

  if (state.phase === "lobby" || state.phase === "playing" || state.phase === "finished") {
    showVideoStage(true);
    if (window.WebRtcGame) {
      WebRtcGame.update(state);
    }
    updateVideoLabels(state);
    updateTurnHighlight(state);
    if (window.WebRtcGame?.isMicEnabled) {
      syncMuteButtons(WebRtcGame.isMicEnabled());
    }
  }
});
