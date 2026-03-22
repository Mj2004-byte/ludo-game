/**
 * Ludo board — 15×15 grid, reference layout: Red TL, Green TR, Yellow BR, Blue BL.
 * Map-pin tokens; positions 1–56 follow PATH_56 cell centers; 57 = finish.
 */
(function () {
  const COLORS = {
    red: "#e53935",
    green: "#43a047",
    yellow: "#fdd835",
    blue: "#1e88e5",
  };

  const HOME = [
    { r: 0, c: 0, key: "red" },
    { r: 0, c: 9, key: "green" },
    { r: 9, c: 9, key: "yellow" },
    { r: 9, c: 0, key: "blue" },
  ];

  function inHome(r, c) {
    if (r < 6 && c < 6) return true;
    if (r < 6 && c > 8) return true;
    if (r > 8 && c > 8) return true;
    if (r > 8 && c < 6) return true;
    return false;
  }

  function buildPath56() {
    const raw = [];
    for (let r = 5; r >= 0; r--) raw.push([r, 6]);
    for (let c = 7; c <= 14; c++) raw.push([0, c]);
    for (let r = 1; r <= 5; r++) raw.push([r, 14]);
    for (let c = 13; c >= 8; c--) raw.push([6, c]);
    for (let r = 7; r <= 14; r++) raw.push([r, 8]);
    for (let c = 13; c >= 0; c--) raw.push([14, c]);
    for (let r = 13; r >= 8; r--) raw.push([r, 0]);
    for (let c = 1; c <= 5; c++) raw.push([8, c]);
    for (let r = 7; r <= 13; r++) raw.push([r, 6]);

    const out = [];
    const seen = new Set();
    for (const [r, c] of raw) {
      if (inHome(r, c)) continue;
      const k = `${r},${c}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([r, c]);
      if (out.length >= 56) break;
    }
    while (out.length < 56) out.push([6, 7]);
    return out.slice(0, 56);
  }

  const PATH_56 = buildPath56();

  const SAFE = new Set(["5,6", "6,13", "8,5", "8,13", "13,0", "13,8", "0,8", "0,6"]);

  function cellCenter(ox, oy, u, row, col) {
    return { x: ox + (col + 0.5) * u, y: oy + (row + 0.5) * u };
  }

  function drawGrid(ctx, ox, oy, u) {
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 15; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + i * u, oy);
      ctx.lineTo(ox + i * u, oy + 15 * u);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox, oy + i * u);
      ctx.lineTo(ox + 15 * u, oy + i * u);
      ctx.stroke();
    }
  }

  function drawHome(ctx, ox, oy, u, hr, hc, color) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + hc * u, oy + hr * u, u * 6, u * 6);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + hc * u, oy + hr * u, u * 6, u * 6);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillRect(ox + (hc + 1) * u, oy + (hr + 1) * u, u * 4, u * 4);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeRect(ox + (hc + 1) * u, oy + (hr + 1) * u, u * 4, u * 4);
    for (let i = 0; i < 4; i++) {
      const dx = (i % 2) * u * 1.2;
      const dy = Math.floor(i / 2) * u * 1.2;
      const p = cellCenter(ox, oy, u, hr + 1.3 + (dy / u) * 0.5, hc + 1.3 + (dx / u) * 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, u * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = "#ddd";
      ctx.fill();
      ctx.strokeStyle = "#999";
      ctx.stroke();
    }
  }

  function drawArms(ctx, ox, oy, u) {
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(ox + 6 * u, oy + 0 * u, u * 3, u * 6);
    ctx.fillRect(ox + 6 * u, oy + 9 * u, u * 3, u * 6);
    ctx.fillRect(ox + 0 * u, oy + 6 * u, u * 6, u * 3);
    ctx.fillRect(ox + 9 * u, oy + 6 * u, u * 6, u * 3);

    ctx.fillStyle = COLORS.red;
    ctx.fillRect(ox + 1 * u, oy + 6 * u, u * 5, u * 3);
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(ox + 6 * u, oy + 1 * u, u * 3, u * 5);
    ctx.fillStyle = COLORS.yellow;
    ctx.fillRect(ox + 6 * u, oy + 9 * u, u * 3, u * 5);
    ctx.fillStyle = COLORS.blue;
    ctx.fillRect(ox + 9 * u, oy + 6 * u, u * 5, u * 3);
  }

  function drawCenter(ctx, ox, oy, u) {
    const cx = ox + 7.5 * u;
    const cy = oy + 7.5 * u;
    const L = ox + 6 * u;
    const R = ox + 9 * u;
    const T = oy + 6 * u;
    const B = oy + 9 * u;

    ctx.fillStyle = COLORS.red;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(L, T);
    ctx.lineTo(cx, T);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLORS.green;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(R, T);
    ctx.lineTo(cx, T);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLORS.yellow;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(R, B);
    ctx.lineTo(cx, B);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLORS.blue;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(L, B);
    ctx.lineTo(cx, B);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 6 * u, oy + 6 * u, u * 3, u * 3);
  }

  function drawStars(ctx, ox, oy, u) {
    SAFE.forEach((key) => {
      const [r, c] = key.split(",").map(Number);
      const p = cellCenter(ox, oy, u, r, c);
      ctx.fillStyle = "rgba(90,90,90,0.9)";
      ctx.font = `${Math.round(u * 0.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("★", p.x, p.y);
    });
  }

  function drawMapPin(ctx, x, y, scale, color, highlight) {
    const s = scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.9);
    ctx.bezierCurveTo(s * 0.6, -s * 0.9, s * 0.6, s * 0.05, 0, s * 1.05);
    ctx.bezierCurveTo(-s * 0.6, s * 0.05, -s * 0.6, -s * 0.9, 0, -s * 0.9);
    ctx.closePath();
    ctx.fillStyle = "#f8f8f8";
    ctx.fill();
    ctx.strokeStyle = "#9e9e9e";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -s * 0.35, s * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.stroke();
    if (highlight) {
      ctx.strokeStyle = "rgba(33,150,243,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -s * 0.35, s * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function homeTokenSlot(ox, oy, u, colorIndex, pieceIndex) {
    const h = HOME[colorIndex];
    const row = h.r + 1 + Math.floor(pieceIndex / 2) * 2;
    const col = h.c + 1 + (pieceIndex % 2) * 2;
    return cellCenter(ox, oy, u, row, col);
  }

  function finishSlot(ox, oy, u, pieceIndex) {
    const o = [
      [7.2, 7.2],
      [7.8, 7.2],
      [7.8, 7.8],
      [7.2, 7.8],
    ];
    const [fr, fc] = o[pieceIndex % 4];
    return { x: ox + fc * u, y: oy + fr * u };
  }

  function positionForPiece(pos, colorIndex, pieceIndex, ox, oy, u) {
    if (pos === 0) return homeTokenSlot(ox, oy, u, colorIndex, pieceIndex);
    if (pos >= 57) return finishSlot(ox, oy, u, pieceIndex);
    const idx = Math.min(pos, 56) - 1;
    const [r, c] = PATH_56[Math.min(idx, PATH_56.length - 1)];
    return cellCenter(ox, oy, u, r, c);
  }

  function drawBoard(ctx, w, h) {
    const pad = Math.min(w, h) * 0.03;
    const s = Math.min(w, h) - pad * 2;
    const ox = (w - s) / 2;
    const oy = (h - s) / 2;
    const u = s / 15;

    ctx.fillStyle = "#f5e6d3";
    ctx.fillRect(ox, oy, s, s);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 3;
    ctx.strokeRect(ox, oy, s, s);

    HOME.forEach((h) => drawHome(ctx, ox, oy, u, h.r, h.c, COLORS[h.key]));
    drawArms(ctx, ox, oy, u);
    drawCenter(ctx, ox, oy, u);
    drawGrid(ctx, ox, oy, u);
    drawStars(ctx, ox, oy, u);

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = `${Math.round(u * 0.45)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const st = cellCenter(ox, oy, u, 6, 0);
    ctx.fillText("▶", st.x, st.y);

    return { ox, oy, u };
  }

  function render(state) {
    const canvas = document.getElementById("ludo-canvas");
    if (!canvas) return;
    const wrap = canvas.closest(".board-wrap") || canvas.parentElement;
    const w = wrap?.clientWidth || 360;
    const h = Math.min(w, 420);
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { ox, oy, u } = drawBoard(ctx, w, h);
    if (!state.players) return;

    const pinScale = u * 0.32;
    const offsets = [
      { dx: -0.12, dy: -0.12 },
      { dx: 0.12, dy: -0.12 },
      { dx: -0.12, dy: 0.12 },
      { dx: 0.12, dy: 0.12 },
    ];

    const turn = state.turn;
    state.players.forEach((pl, pi) => {
      const c = COLORS[pl.color] || "#888";
      pl.pieces.forEach((pos, idx) => {
        const base = positionForPiece(pos, pi, idx, ox, oy, u);
        const off = offsets[idx];
        const x = base.x + off.dx * u;
        const y = base.y + off.dy * u;
        const isTurn = state.phase === "playing" && turn === pi;
        const highlight = isTurn && state.diceRolled && pos < 57;
        drawMapPin(ctx, x, y, pinScale, c, highlight);
      });
    });
  }

  window.LudoBoard = { render };
})();
