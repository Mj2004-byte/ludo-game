/** In-memory rooms: roomId -> room */

const MAX_PLAYERS = 4;

const COLORS = ["red", "green", "yellow", "blue"];

const rooms = new Map();

function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 3; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return "LUDO" + suffix;
}

function generatePassword() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function emptyPieces() {
  return [0, 0, 0, 0];
}

function createGameState() {
  return {
    phase: "lobby",
    turn: 0,
    lastDice: null,
    diceRolled: false,
    winner: null,
    sixRollStreak: 0,
    gameNotice: null,
  };
}

/** Simplified Ludo: piece 0 = home; 1–56 on track; 57 = finished */
function createRoom() {
  let roomId = generateRoomId();
  while (rooms.has(roomId)) {
    roomId = generateRoomId();
  }
  const password = generatePassword();
  const room = {
    id: roomId,
    password,
    hostSocketId: null,
    players: [],
    game: createGameState(),
    lobbyDeadline: null,
    _lobbyTimer: null,
    _aiTimer: null,
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(String(roomId).toUpperCase()) || null;
}

function removeRoom(roomId) {
  rooms.delete(roomId);
}

function humanCount(room) {
  return room.players.filter((p) => !p.isAI).length;
}

function addPlayer(room, socketId, name) {
  if (room.players.length >= MAX_PLAYERS) {
    return { error: "Room is full (4 players)." };
  }
  const color = COLORS[room.players.length];
  room.players.push({
    socketId,
    isAI: false,
    name: String(name || "Player").slice(0, 24),
    color,
    pieces: emptyPieces(),
  });
  if (room.players.length === 1) {
    room.hostSocketId = socketId;
  }
  return { player: room.players[room.players.length - 1] };
}

function fillAIPlayers(room) {
  let n = 1;
  while (room.players.length < MAX_PLAYERS) {
    const color = COLORS[room.players.length];
    room.players.push({
      socketId: null,
      isAI: true,
      name: `AI ${n}`,
      color,
      pieces: emptyPieces(),
    });
    n += 1;
  }
}

function removePlayerBySocket(room, socketId) {
  const idx = room.players.findIndex((p) => p.socketId === socketId);
  if (idx === -1) return;
  room.players.splice(idx, 1);
  if (room.hostSocketId === socketId) {
    const nextHuman = room.players.find((p) => p.socketId && !p.isAI);
    room.hostSocketId = nextHuman?.socketId ?? null;
  }
  if (room.players.length === 0) {
    if (room._lobbyTimer) clearTimeout(room._lobbyTimer);
    if (room._aiTimer) clearTimeout(room._aiTimer);
    removeRoom(room.id);
  }
}

function findPlayerIndex(room, socketId) {
  return room.players.findIndex((p) => p.socketId === socketId);
}

function publicRoom(room) {
  if (!room) return null;
  const gameNotice = room.game.gameNotice;
  room.game.gameNotice = null;
  return {
    id: room.id,
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    phase: room.game.phase,
    hostSocketId: room.hostSocketId,
    lobbyDeadlineMs: room.game.phase === "lobby" ? room.lobbyDeadline : null,
    peerSocketIds: (() => {
      const ids = room.players.map((p) => (p.socketId ? p.socketId : null));
      while (ids.length < MAX_PLAYERS) ids.push(null);
      return ids.slice(0, MAX_PLAYERS);
    })(),
    players: room.players.map((p) => ({
      name: p.name,
      color: p.color,
      pieces: [...p.pieces],
      isAI: !!p.isAI,
    })),
    turn: room.game.turn,
    lastDice: room.game.lastDice,
    diceRolled: room.game.diceRolled,
    winner: room.game.winner,
    gameNotice,
  };
}

function rollDice() {
  return 1 + Math.floor(Math.random() * 6);
}

/** Valid piece indices for current dice (must be rolled). */
function getValidMoves(room, playerIndex) {
  const g = room.game;
  if (!g.diceRolled || g.lastDice == null) return [];
  if (g.turn !== playerIndex) return [];
  const dice = g.lastDice;
  const p = room.players[playerIndex];
  const out = [];
  for (let i = 0; i < 4; i++) {
    let pos = p.pieces[i];
    if (pos === 57) continue;
    if (pos === 0) {
      if (dice === 6) out.push(i);
    } else if (pos < 57) {
      const next = pos + dice;
      if (next <= 57) out.push(i);
    }
  }
  return out;
}

function passTurnBecauseNoMoves(room) {
  const g = room.game;
  const idx = g.turn;
  const moves = getValidMoves(room, idx);
  if (moves.length > 0) return false;
  g.turn = (g.turn + 1) % room.players.length;
  g.diceRolled = false;
  g.lastDice = null;
  g.sixRollStreak = 0;
  return true;
}

/** Move one piece: simplified rules — no captures, one lap then home stretch */
function tryMove(room, playerIndex, pieceIndex) {
  const g = room.game;
  if (g.phase !== "playing" || g.winner != null) return { error: "Game not in progress." };
  if (g.turn !== playerIndex) return { error: "Not your turn." };
  if (!g.diceRolled || g.lastDice == null) return { error: "Roll the dice first." };

  const p = room.players[playerIndex];
  const dice = g.lastDice;
  let pos = p.pieces[pieceIndex];

  if (pos === 0) {
    if (dice !== 6) return { error: "Need a 6 to leave home." };
    pos = 1;
  } else if (pos < 57) {
    const next = pos + dice;
    if (next > 57) return { error: "Move overshoots finish." };
    pos = next;
  } else {
    return { error: "Piece already finished." };
  }

  p.pieces[pieceIndex] = pos;

  const allHome = p.pieces.every((x) => x === 57);
  if (allHome) {
    g.winner = playerIndex;
    g.phase = "finished";
    return { ok: true, winner: playerIndex };
  }

  if (dice === 6) {
    g.diceRolled = false;
    g.lastDice = null;
  } else {
    g.turn = (g.turn + 1) % room.players.length;
    g.diceRolled = false;
    g.lastDice = null;
    g.sixRollStreak = 0;
  }

  return { ok: true };
}

function tryRoll(room, playerIndex) {
  const g = room.game;
  if (g.phase !== "playing" || g.winner != null) return { error: "Cannot roll now." };
  if (g.turn !== playerIndex) return { error: "Not your turn." };
  if (g.diceRolled) return { error: "Already rolled." };

  const d = rollDice();

  if (d === 6) {
    g.sixRollStreak = (g.sixRollStreak || 0) + 1;
    if (g.sixRollStreak >= 3) {
      g.sixRollStreak = 0;
      g.gameNotice = "Three 6s in a row — turn forfeited.";
      g.turn = (g.turn + 1) % room.players.length;
      g.diceRolled = false;
      g.lastDice = null;
      return { ok: true, dice: d, thirdSixForfeit: true };
    }
  } else {
    g.sixRollStreak = 0;
  }

  g.lastDice = d;
  g.diceRolled = true;
  passTurnBecauseNoMoves(room);
  return { ok: true, dice: d };
}

function startGame(room) {
  if (room.players.length < 1) return { error: "Room has no players." };
  room.game = {
    phase: "playing",
    turn: 0,
    lastDice: null,
    diceRolled: false,
    winner: null,
    sixRollStreak: 0,
    gameNotice: null,
  };
  room.players.forEach((p) => {
    p.pieces = emptyPieces();
  });
  if (room._lobbyTimer) clearTimeout(room._lobbyTimer);
  room._lobbyTimer = null;
  room.lobbyDeadline = null;
  return { ok: true };
}

/** AI: prefer finishing a piece, else random valid move. */
function pickAiPieceIndex(room, playerIndex) {
  const moves = getValidMoves(room, playerIndex);
  if (moves.length === 0) return null;
  const p = room.players[playerIndex];
  const dice = room.game.lastDice;
  for (const i of moves) {
    const pos = p.pieces[i];
    if (pos > 0 && pos + dice === 57) return i;
  }
  return moves[Math.floor(Math.random() * moves.length)];
}

module.exports = {
  MAX_PLAYERS,
  createRoom,
  getRoom,
  removeRoom,
  addPlayer,
  fillAIPlayers,
  removePlayerBySocket,
  findPlayerIndex,
  humanCount,
  publicRoom,
  tryMove,
  tryRoll,
  startGame,
  getValidMoves,
  pickAiPieceIndex,
};
