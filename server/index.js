const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const {
  createRoom,
  getRoom,
  addPlayer,
  fillAIPlayers,
  removePlayerBySocket,
  findPlayerIndex,
  humanCount,
  publicRoom,
  tryRoll,
  tryMove,
  startGame,
  pickAiPieceIndex,
} = require("./rooms");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

const LOBBY_MS = 60000;
const AI_STEP_MS = 550;

app.use(cors());
app.use(express.static(path.join(__dirname, "..", "public")));

async function broadcastRoom(room) {
  if (!room) return;
  const sockets = await io.in(room.id).fetchSockets();
  const base = publicRoom(room);
  for (const s of sockets) {
    const idx = findPlayerIndex(room, s.id);
    s.emit("room:state", { ...base, myIndex: idx });
  }
}

function scheduleLobbyCountdown(room) {
  if (!room || room.game.phase !== "lobby") return;
  if (humanCount(room) === 0) return;
  if (room._lobbyTimer) clearTimeout(room._lobbyTimer);
  room.lobbyDeadline = Date.now() + LOBBY_MS;
  room._lobbyTimer = setTimeout(() => {
    room._lobbyTimer = null;
    const r = getRoom(room.id);
    if (!r || r.game.phase !== "lobby") return;
    beginGameFromLobby(r);
  }, LOBBY_MS);
}

function beginGameFromLobby(room) {
  if (!room || room.game.phase !== "lobby") return;
  if (humanCount(room) === 0) return;

  if (room._lobbyTimer) clearTimeout(room._lobbyTimer);
  room._lobbyTimer = null;
  room.lobbyDeadline = null;

  if (room.players.length < 4) {
    fillAIPlayers(room);
  }

  const result = startGame(room);
  if (result.error) return;
  void broadcastRoom(room)
    .catch((err) => console.error("broadcastRoom", err))
    .then(() => runAiIfNeeded(getRoom(room.id)));
}

function runAiIfNeeded(room) {
  if (!room) return;
  const id = room.id;
  const r = getRoom(id);
  if (!r || r.game.phase !== "playing" || r.game.winner != null) return;
  const cur = r.players[r.game.turn];
  if (!cur?.isAI) return;

  if (r._aiTimer) clearTimeout(r._aiTimer);
  r._aiTimer = setTimeout(() => {
    r._aiTimer = null;
    const room2 = getRoom(id);
    if (!room2 || room2.game.phase !== "playing" || room2.game.winner != null) return;
    const ti = room2.game.turn;
    const pl = room2.players[ti];
    if (!pl?.isAI) return;

    if (!room2.game.diceRolled) {
      const rr = tryRoll(room2, ti);
      if (!rr.ok) {
        void broadcastRoom(room2).catch((e) => console.error(e));
        return;
      }
      void broadcastRoom(room2)
        .catch((e) => console.error(e))
        .then(() => runAiIfNeeded(getRoom(id)));
      return;
    }

    const pieceIdx = pickAiPieceIndex(room2, ti);
    if (pieceIdx === null) {
      void broadcastRoom(room2)
        .catch((e) => console.error(e))
        .then(() => runAiIfNeeded(getRoom(id)));
      return;
    }
    tryMove(room2, ti, pieceIdx);
    void broadcastRoom(room2)
      .catch((e) => console.error(e))
      .then(() => runAiIfNeeded(getRoom(id)));
  }, AI_STEP_MS);
}

io.on("connection", (socket) => {
  let joinedRoomId = null;

  socket.on("room:create", ({ name }, ack) => {
    const room = createRoom();
    const result = addPlayer(room, socket.id, name);
    if (result.error) {
      ack?.({ error: result.error });
      return;
    }
    socket.join(room.id);
    joinedRoomId = room.id;
    ack?.({
      roomId: room.id,
      password: room.password,
    });
    if (humanCount(room) === 4 && room.players.length === 4) {
      beginGameFromLobby(room);
    } else {
      scheduleLobbyCountdown(room);
      void broadcastRoom(room).catch((err) => console.error("broadcastRoom", err));
    }
  });

  socket.on("room:join", ({ roomId, password, name }, ack) => {
    const id = String(roomId || "")
      .toUpperCase()
      .trim();
    const room = getRoom(id);
    if (!room) {
      ack?.({ error: "Room not found." });
      return;
    }
    if (String(room.password) !== String(password)) {
      ack?.({ error: "Wrong password." });
      return;
    }
    const result = addPlayer(room, socket.id, name);
    if (result.error) {
      ack?.({ error: result.error });
      return;
    }
    socket.join(room.id);
    joinedRoomId = room.id;
    ack?.({ ok: true, roomId: room.id });
    if (humanCount(room) === 4 && room.players.length === 4) {
      beginGameFromLobby(room);
    } else {
      scheduleLobbyCountdown(room);
      void broadcastRoom(room).catch((err) => console.error("broadcastRoom", err));
    }
  });

  socket.on("webrtc:signal", ({ to, signal }) => {
    if (!to || !signal || !joinedRoomId) return;
    const room = getRoom(joinedRoomId);
    if (!room) return;
    const ids = room.players.map((p) => p.socketId).filter(Boolean);
    if (!ids.includes(socket.id) || !ids.includes(to)) return;
    io.to(to).emit("webrtc:signal", { from: socket.id, signal });
  });

  socket.on("game:start", (...args) => {
    const ack = typeof args[args.length - 1] === "function" ? args.pop() : null;
    const room = joinedRoomId ? getRoom(joinedRoomId) : null;
    if (!room || room.hostSocketId !== socket.id) {
      ack?.({ error: "Only the host can start the game." });
      return;
    }
    if (room.game.phase !== "lobby") {
      ack?.({ error: "Game already started." });
      return;
    }
    ack?.({ ok: true });
    beginGameFromLobby(room);
  });

  socket.on("game:roll", (ack) => {
    const room = joinedRoomId ? getRoom(joinedRoomId) : null;
    if (!room) {
      ack?.({ error: "Not in a room." });
      return;
    }
    const idx = findPlayerIndex(room, socket.id);
    if (idx < 0) {
      ack?.({ error: "Not a player." });
      return;
    }
    const result = tryRoll(room, idx);
    if (result.error) {
      ack?.({ error: result.error });
      return;
    }
    ack?.({
      ok: true,
      dice: result.dice,
      thirdSixForfeit: !!result.thirdSixForfeit,
    });
    void broadcastRoom(room)
      .catch((err) => console.error("broadcastRoom", err))
      .then(() => runAiIfNeeded(getRoom(room.id)));
  });

  socket.on("game:move", ({ pieceIndex }, ack) => {
    const room = joinedRoomId ? getRoom(joinedRoomId) : null;
    if (!room) {
      ack?.({ error: "Not in a room." });
      return;
    }
    const idx = findPlayerIndex(room, socket.id);
    if (idx < 0) {
      ack?.({ error: "Not a player." });
      return;
    }
    const pi = Number(pieceIndex);
    if (!Number.isInteger(pi) || pi < 0 || pi > 3) {
      ack?.({ error: "Invalid piece." });
      return;
    }
    const result = tryMove(room, idx, pi);
    if (result.error) {
      ack?.({ error: result.error });
      return;
    }
    ack?.({ ok: true, winner: result.winner ?? null });
    void broadcastRoom(room)
      .catch((err) => console.error("broadcastRoom", err))
      .then(() => runAiIfNeeded(getRoom(room.id)));
  });

  socket.on("disconnect", () => {
    if (!joinedRoomId) return;
    const room = getRoom(joinedRoomId);
    if (!room) return;
    removePlayerBySocket(room, socket.id);
    socket.leave(room.id);
    joinedRoomId = null;
    if (room.game.phase === "lobby" && humanCount(room) > 0) {
      scheduleLobbyCountdown(room);
    }
    void broadcastRoom(room).catch((err) => console.error("broadcastRoom", err));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ludo server http://localhost:${PORT}`);
});
