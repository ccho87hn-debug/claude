const { TYPES, NAMES, EMOJI, clash, odds, payout, validate, randomLineup, settle, normalizeCode, packUnits, unpackUnits, survivors } = window.RPS;

// ---------- Arena constants (logical units; the canvas scales them to fit) ----------
const W = 900;
const H = 600;
const R = 16; // collision radius
const GLYPH = 40; // drawn size of a hand
const BASE_SPEED = 105;
const STEER = 160;
const SUDDEN_DEATH_AT = 60; // seconds; after this, everyone speeds up so a round always ends
const COLORS = { rock: "#ff5a4e", paper: "#3d9bff", scissors: "#3fd46f" };
const START_COINS = 1000;
const BAILOUT = 500;
const SNAP_EVERY = 50; // ms between position updates the host sends to guests

const $ = (id) => document.getElementById(id);
const canvas = $("arena");
const ctx = canvas.getContext("2d");

// ---------- Saved state ----------
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem("rpsBattle.save"));
    if (s && Number.isInteger(s.coins)) return { wins: 0, losses: 0, best: 0, ...s };
  } catch {}
  return { coins: START_COINS, wins: 0, losses: 0, best: 0 };
}
const save = loadSave();
function persist() {
  try { localStorage.setItem("rpsBattle.save", JSON.stringify(save)); } catch {}
}
const cleanName = (n) => String(n || "").trim().slice(0, 8) || "손님";

// Small DOM helper: el("div", { className: "x" }, child, "text", ...)
function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of children) e.append(c);
  return e;
}

// ---------- Round state ----------
// idle -> countdown (1, 2, 3) -> betting (lineup shown, player bets) -> running -> done
let phase = "idle";
let units = [];
let particles = [];
let lineup = null;
let pick = null; // my choice while betting
let clock = 0;
let countdown = 0;
let revealAt = 0; // time the lineup was revealed, for the pop-in animation and banner
let goAt = -1; // time the battle started, for the "GO!" flash
let speed = 1;

// ---------- Players ----------
// Solo play is a room of one: the same code path with no network.
let mode = "solo"; // solo | host | guest
let room = null; // Net.Room while online
let myId = "host"; // the host (and a solo player) is always "host"; guests use their peer id
let members = []; // [{ id, name }]
let roomBets = {}; // id -> { pick, bet } confirmed this round
let locked = false; // a guest has sent their bet
let staked = 0; // coins taken from my wallet this round, refunded if the room drops before the end
let lastSnap = 0;

// ---------- Sprites: each hand is pre-drawn once at high resolution ----------
const sprites = {};
function buildSprites() {
  const px = GLYPH * 3;
  for (const t of TYPES) {
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    g.font = `${Math.round(px * 0.8)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const glyph = () => g.fillText(EMOJI[t], px / 2, px / 2 + px * 0.04);
    // Recolour the hand in its team colour but keep the emoji's shading and outline:
    // draw it in grey, multiply by the colour, then cut back to the hand's own shape.
    g.filter = "grayscale(1) brightness(1.35) contrast(1.1)";
    glyph();
    g.filter = "none";
    g.globalCompositeOperation = "multiply";
    g.fillStyle = COLORS[t];
    g.fillRect(0, 0, px, px);
    g.globalCompositeOperation = "destination-in";
    glyph();
    g.globalCompositeOperation = "source-over";
    sprites[t] = c;
  }
}

// ---------- Placement ----------
// Scatter units across the arena without overlaps (gives up after a few tries per unit when crowded).
function spawn(c) {
  const list = [];
  for (const t of TYPES) {
    for (let i = 0; i < c[t]; i++) {
      let x, y, tries = 0;
      do {
        x = R + 20 + Math.random() * (W - 2 * R - 40);
        y = R + 50 + Math.random() * (H - 2 * R - 70);
      } while (tries++ < 60 && list.some((u) => (u.x - x) ** 2 + (u.y - y) ** 2 < (R * 2.6) ** 2));
      const a = Math.random() * Math.PI * 2;
      list.push({
        x, y, type: t,
        vx: Math.cos(a) * BASE_SPEED, vy: Math.sin(a) * BASE_SPEED,
        flash: 0, bob: Math.random() * 6, delay: Math.random() * 0.7,
      });
    }
  }
  return list;
}

// ---------- Panels ----------
function showPanel(id) {
  for (const p of ["lobbyPanel", "roomPanel", "countPanel", "betPanel", "livePanel"]) $(p).classList.toggle("hidden", p !== id);
}

const nameOf = (id) => (members.find((m) => m.id === id) || {}).name || "?";

function refreshRoom() {
  $("roomCode").textContent = room ? room.code : "";
  $("roomTip").textContent = mode === "host"
    ? "친구에게 이 코드를 알려 주세요. 친구는 자기 컴퓨터에서 '참가'에 코드를 넣으면 들어와요."
    : "방에 들어왔어요. 판이 시작되면 같이 걸 수 있어요.";
  $("members").replaceChildren(...members.map((m) => {
    const tags = [m.id === "host" ? "방장" : "", m.id === myId ? "나" : ""].filter(Boolean).join(" · ");
    return el("div", { className: "member" }, el("b", { textContent: m.name }), el("small", { textContent: tags }));
  }));
  $("newRound").classList.toggle("hidden", mode !== "host");
  $("roomWait").classList.toggle("hidden", mode !== "guest");
}

// Everyone's bets in this room (online only).
function betRows() {
  return members.map((m) => {
    const b = roomBets[m.id];
    const what = !b ? "고르는 중..." : `${EMOJI[b.pick]} ${NAMES[b.pick]} · ` + (b.bet ? `🪙 ${b.bet.toLocaleString()}` : "구경");
    return el("div", { className: "room-bet " + (b ? b.pick : "") }, el("b", { textContent: m.name }), el("span", { textContent: what }));
  });
}

function refreshBet() {
  if (!lineup) return;
  $("lRock").textContent = lineup.rock;
  $("lPaper").textContent = lineup.paper;
  $("lScissors").textContent = lineup.scissors;
  for (const btn of document.querySelectorAll(".pick")) {
    const o = odds(lineup, btn.dataset.type);
    btn.querySelector(".odds").textContent = o ? `x${o}` : "-";
    btn.disabled = !o || locked;
    btn.classList.toggle("selected", btn.dataset.type === pick);
  }
  document.querySelectorAll(".bet input, .bet button").forEach((e) => (e.disabled = locked));
  const b = Math.floor(+$("betAmount").value);
  const err = validate({ counts: lineup, pick, bet: b, coins: save.coins });
  const hint = $("hint");
  hint.classList.toggle("warn", !!err && !locked);
  if (locked) hint.textContent = "다른 사람들이 다 걸면 방장이 배틀을 시작해요.";
  else if (err) hint.textContent = err;
  else if (b === 0) hint.textContent = "0코인이면 구경만 해요.";
  else hint.textContent = `이기면 🪙 ${payout(b, lineup, pick).toLocaleString()} 받아요.`;

  const start = $("start");
  if (mode === "guest") {
    start.textContent = locked ? "걸었어요 ✓" : "이걸로 걸기";
    start.disabled = locked || !!err;
  } else {
    const others = members.filter((m) => m.id !== myId);
    const ready = others.filter((m) => roomBets[m.id]).length;
    start.textContent = others.length ? `배틀 시작! (친구 ${ready}/${others.length}명 걸었어요)` : "배틀 시작!";
    start.disabled = !!err;
  }
  const list = $("roomBets");
  list.classList.toggle("hidden", mode === "solo");
  if (mode !== "solo") list.replaceChildren(...betRows());
}

function refreshWallet() {
  $("coins").textContent = save.coins.toLocaleString();
  $("bailout").classList.toggle("hidden", !(save.coins < 10 && phase !== "running" && phase !== "countdown"));
  $("betAmount").max = save.coins;
  const total = save.wins + save.losses;
  $("record").innerHTML = total
    ? `전적 ${save.wins}승 ${save.losses}패 (승률 ${Math.round((save.wins / total) * 100)}%)<br>최고 획득 🪙 ${save.best.toLocaleString()}`
    : "";
}

// ---------- Round flow ----------
// Solo and host decide everything; a guest follows the host's messages.
function newRound() {
  if (mode === "guest") return;
  if (room) room.send({ t: "countdown" });
  beginCountdown();
}

function beginCountdown() {
  phase = "countdown";
  countdown = 3;
  units = [];
  particles = [];
  lineup = null;
  pick = null;
  roomBets = {};
  locked = false;
  staked = 0;
  clock = 0;
  goAt = -1;
  $("result").classList.add("hidden");
  showPanel("countPanel");
  refreshWallet();
  updateHud();
}

function reveal() {
  lineup = randomLineup();
  units = spawn(lineup);
  if (room) room.send({ t: "reveal", lineup, u: packUnits(units) });
  enterBetting();
}

function enterBetting() {
  revealAt = performance.now();
  phase = "betting";
  const b = $("betAmount");
  if (+b.value > save.coins) b.value = save.coins;
  showPanel("betPanel");
  refreshBet();
  refreshWallet();
  updateHud();
}

function onStartClick() {
  const bet = Math.floor(+$("betAmount").value);
  if (validate({ counts: lineup, pick, bet, coins: save.coins })) return;
  if (mode === "guest") {
    locked = true;
    room.send({ t: "bet", pick, bet });
    refreshBet();
    return;
  }
  roomBets[myId] = { pick, bet };
  if (room) room.send({ t: "go", bets: roomBets });
  go();
}

function go() {
  const mine = roomBets[myId];
  staked = mine ? mine.bet : 0;
  save.coins -= staked;
  persist();
  phase = "running";
  goAt = performance.now();
  lastSnap = 0;
  beep(1040, 0.15, "sine");
  showPanel("livePanel");
  $("liveBet").innerHTML = !mine
    ? "이번 판은 구경 중이에요."
    : mine.bet
      ? `${EMOJI[mine.pick]} <b>${NAMES[mine.pick]}</b>에 🪙 ${mine.bet.toLocaleString()} 걸었어요<br>배당 x${odds(lineup, mine.pick)} · 이기면 🪙 ${payout(mine.bet, lineup, mine.pick).toLocaleString()}`
      : `${EMOJI[mine.pick]} <b>${NAMES[mine.pick]}</b> 응원 중 (구경 모드)`;
  $("liveBets").replaceChildren(...(mode === "solo" ? [] : betRows()));
  $("speedRow").classList.toggle("hidden", mode === "guest");
  refreshWallet();
}

function finishRound(winner) {
  phase = "done";
  if (mode === "host") room.send({ t: "end", winner });
  for (const u of units) u.type = winner;
  const mine = roomBets[myId];
  const r = mine ? settle(mine, lineup, winner) : null;
  staked = 0;
  if (r) {
    save.coins += r.returned;
    if (mine.bet > 0) {
      if (r.won) { save.wins++; save.best = Math.max(save.best, r.delta); } else save.losses++;
    }
    persist();
  }
  refreshWallet();
  updateHud();
  $("resultEmoji").textContent = EMOJI[winner];
  $("resultTitle").textContent = `${NAMES[winner]} 최종 승리!`;
  const rc = $("resultCoins");
  rc.className = "result-coins " + (r && r.won ? "win" : "lose");
  if (!r) rc.textContent = "구경 끝!";
  else if (mine.bet === 0) rc.textContent = r.won ? "응원 성공! 🎉" : "아쉽네요!";
  else rc.textContent = r.won ? `적중! +🪙 ${r.delta.toLocaleString()}` : `꽝! -🪙 ${mine.bet.toLocaleString()}`;
  // Everyone else's outcome, online only.
  const others = mode === "solo" ? [] : members.filter((m) => m.id !== myId && roomBets[m.id]);
  $("resultLines").replaceChildren(...others.map((m) => {
    const b = roomBets[m.id];
    const o = settle(b, lineup, winner);
    const text = b.bet === 0 ? (o.won ? "응원 성공" : "아쉽네요") : o.won ? `+🪙 ${o.delta.toLocaleString()}` : `-🪙 ${b.bet.toLocaleString()}`;
    return el("div", { className: "result-line " + (o.won ? "win" : "lose") }, el("b", { textContent: m.name }), el("span", { textContent: `${EMOJI[b.pick]} ${text}` }));
  }));
  $("again").classList.toggle("hidden", mode === "guest");
  $("resultWait").classList.toggle("hidden", mode !== "guest");
  $("result").classList.remove("hidden");
  const won = r && r.won;
  beep(won ? 880 : 220, 0.25, won ? "triangle" : "sawtooth");
}

// ---------- Lobby and rooms ----------
function lobbyMessage(text, warn = false) {
  const m = $("lobbyMsg");
  m.textContent = text;
  m.classList.toggle("warn", warn);
}

function setName() {
  save.name = cleanName($("myName").value);
  $("myName").value = save.name;
  persist();
  return save.name;
}

function playSolo() {
  mode = "solo";
  myId = "host";
  members = [{ id: myId, name: setName() }];
  newRound();
}

const handlers = {
  onMessage: (from, msg) => (mode === "host" ? hostReceive(from, msg) : guestReceive(msg)),
  onLeave: (id) => {
    members = members.filter((m) => m.id !== id);
    delete roomBets[id];
    broadcastMembers();
    if (phase === "betting") refreshBet();
  },
  onClosed: () => leaveRoom("방이 닫혔어요. 방장이 나갔거나 연결이 끊겼어요."),
};

async function hostRoom() {
  const name = setName();
  lobbyMessage("방을 만드는 중이에요...");
  try {
    room = await Net.Room.host(handlers);
  } catch (e) {
    lobbyMessage(e.message, true);
    return;
  }
  mode = "host";
  myId = "host";
  members = [{ id: myId, name }];
  phase = "idle";
  lobbyMessage("");
  showPanel("roomPanel");
  refreshRoom();
}

async function joinRoom() {
  const code = normalizeCode($("joinCode").value);
  if (code.length !== 5) { lobbyMessage("방 코드 5자리를 넣어 주세요.", true); return; }
  const name = setName();
  lobbyMessage("방에 들어가는 중이에요...");
  try {
    room = await Net.Room.join(code, handlers);
  } catch (e) {
    lobbyMessage(e.message, true);
    return;
  }
  mode = "guest";
  myId = room.peer.id;
  members = [];
  phase = "idle";
  room.send({ t: "hello", name });
  lobbyMessage("");
  showPanel("roomPanel");
  refreshRoom();
}

function leaveRoom(why = "") {
  if (staked && phase !== "done") {
    save.coins += staked; // the round never finished, so the bet comes back
    persist();
  }
  staked = 0;
  if (room) room.close();
  room = null;
  mode = "solo";
  members = [];
  roomBets = {};
  phase = "idle";
  units = [];
  particles = [];
  lineup = null;
  clock = 0;
  $("result").classList.add("hidden");
  showPanel("lobbyPanel");
  lobbyMessage(why, !!why);
  refreshWallet();
  updateHud();
}

function broadcastMembers() {
  room.send({ t: "room", members });
  refreshRoom();
}

function hostReceive(from, msg) {
  if (msg.t === "hello") {
    if (members.some((m) => m.id === from)) return;
    if (members.length >= 8) { room.sendTo(from, { t: "full" }); room.kick(from); return; }
    members.push({ id: from, name: cleanName(msg.name) });
    broadcastMembers();
    // Late joiners can still bet on a round that is being bet on.
    if (phase === "betting") {
      room.sendTo(from, { t: "reveal", lineup, u: packUnits(units) });
      room.sendTo(from, { t: "bets", bets: roomBets });
      refreshBet();
    }
  } else if (msg.t === "bet" && phase === "betting") {
    const bet = Math.floor(+msg.bet);
    if (!TYPES.includes(msg.pick) || !odds(lineup, msg.pick) || !(bet >= 0)) return;
    roomBets[from] = { pick: msg.pick, bet };
    room.send({ t: "bets", bets: roomBets });
    refreshBet();
  }
}

function guestReceive(msg) {
  switch (msg.t) {
    case "room":
      members = msg.members;
      refreshRoom();
      if (phase === "betting") refreshBet();
      break;
    case "full":
      leaveRoom("방이 꽉 찼어요.");
      break;
    case "countdown":
      beginCountdown();
      break;
    case "reveal":
      if (phase === "betting") return;
      if (phase !== "countdown") beginCountdown();
      lineup = msg.lineup;
      units = unpackUnits(msg.u).map(withLooks);
      enterBetting();
      break;
    case "bets":
      roomBets = msg.bets || {};
      if (phase === "betting") refreshBet();
      break;
    case "go":
      if (!lineup) return;
      roomBets = msg.bets || {};
      if (roomBets[myId]) pick = roomBets[myId].pick;
      go();
      break;
    case "snap":
      applySnap(msg);
      break;
    case "end":
      if (phase === "running") finishRound(msg.winner);
      break;
  }
}

function withLooks(u) {
  return { ...u, tx: u.x, ty: u.y, vx: 0, vy: 0, flash: 0, bob: Math.random() * 6, delay: Math.random() * 0.7 };
}

// A guest moves its hands toward the host's latest positions and plays the effects for any switches.
function applySnap(msg) {
  if (phase !== "running") return;
  const next = unpackUnits(msg.u);
  if (next.length !== units.length) units = next.map(withLooks);
  next.forEach((n, i) => {
    const u = units[i];
    u.tx = n.x;
    u.ty = n.y;
    if (u.type !== n.type) {
      u.type = n.type;
      u.flash = 0.35;
      burst(u.x, u.y, COLORS[n.type]);
      beep({ rock: 330, paper: 440, scissors: 554 }[n.type], 0.06, "square");
    }
  });
  clock = msg.c;
}

function followHost(dt) {
  const k = Math.min(1, dt * 18);
  for (const u of units) {
    u.x += (u.tx - u.x) * k;
    u.y += (u.ty - u.y) * k;
    if (u.flash > 0) u.flash -= dt;
  }
  stepParticles(dt);
}

// ---------- Simulation ----------
function step(dt) {
  const boost = clock > SUDDEN_DEATH_AT ? 1 + Math.min(1.5, (clock - SUDDEN_DEATH_AT) / 20) : 1;
  const maxSpeed = BASE_SPEED * boost;

  // Chase the nearest prey, flee the nearest hunter.
  for (const u of units) {
    let prey = null, pd = Infinity, hunter = null, hd = Infinity;
    for (const o of units) {
      if (o === u || o.type === u.type) continue;
      const d = (o.x - u.x) ** 2 + (o.y - u.y) ** 2;
      if (clash(u.type, o.type) === u.type) { if (d < pd) { pd = d; prey = o; } }
      else if (d < hd) { hd = d; hunter = o; }
    }
    let ax = 0, ay = 0;
    if (prey && pd < 280 * 280) {
      const d = Math.sqrt(pd) || 1;
      ax += ((prey.x - u.x) / d) * STEER;
      ay += ((prey.y - u.y) / d) * STEER;
    }
    if (hunter && hd < 130 * 130) {
      const d = Math.sqrt(hd) || 1;
      ax -= ((hunter.x - u.x) / d) * STEER * 1.2;
      ay -= ((hunter.y - u.y) / d) * STEER * 1.2;
    }
    const j = Math.random() * Math.PI * 2;
    ax += Math.cos(j) * 90;
    ay += Math.sin(j) * 90;
    u.vx += ax * dt * boost;
    u.vy += ay * dt * boost;
    const sp = Math.hypot(u.vx, u.vy) || 1;
    u.vx = (u.vx / sp) * maxSpeed;
    u.vy = (u.vy / sp) * maxSpeed;
  }

  for (const u of units) {
    u.x += u.vx * dt;
    u.y += u.vy * dt;
    if (u.x < R) { u.x = R; u.vx = Math.abs(u.vx); }
    if (u.x > W - R) { u.x = W - R; u.vx = -Math.abs(u.vx); }
    if (u.y < R) { u.y = R; u.vy = Math.abs(u.vy); }
    if (u.y > H - R) { u.y = H - R; u.vy = -Math.abs(u.vy); }
    if (u.flash > 0) u.flash -= dt;
  }

  // Bounce off each other; different types fight and the loser switches sides.
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    for (let k = i + 1; k < units.length; k++) {
      const b = units[k];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 4 * R * R || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, ny = dy / d;
      const overlap = 2 * R - d;
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2; b.y += ny * overlap / 2;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        a.vx += rel * nx; a.vy += rel * ny;
        b.vx -= rel * nx; b.vy -= rel * ny;
      }
      if (a.type !== b.type) {
        const w = clash(a.type, b.type);
        const loser = a.type === w ? b : a;
        loser.type = w;
        loser.flash = 0.35;
        burst(loser.x, loser.y, COLORS[w]);
        beep({ rock: 330, paper: 440, scissors: 554 }[w], 0.06, "square");
      }
    }
  }

  stepParticles(dt);
  clock += dt;
  const winner = survivors(units);
  if (winner) finishRound(winner);
}

function stepParticles(dt) {
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);
}

function burst(x, y, color) {
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 120;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, color });
  }
}

// ---------- Drawing ----------
let floor = null;
function buildFloor(scale) {
  const c = document.createElement("canvas");
  c.width = W * scale; c.height = H * scale;
  const g = c.getContext("2d");
  g.scale(scale, scale);
  const bg = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
  bg.addColorStop(0, "#343c50");
  bg.addColorStop(1, "#1a1e2b");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // checkered turf
  const tile = 50;
  g.fillStyle = "rgba(255,255,255,.035)";
  for (let y = 0; y < H; y += tile) for (let x = (y / tile) % 2 ? tile : 0; x < W; x += tile * 2) g.fillRect(x, y, tile, tile);
  // centre markings
  g.strokeStyle = "rgba(255,255,255,.12)";
  g.lineWidth = 3;
  g.beginPath(); g.arc(W / 2, H / 2, 80, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  // walls
  g.lineWidth = 8;
  g.strokeStyle = "rgba(0,0,0,.35)";
  g.strokeRect(4, 4, W - 8, H - 8);
  return c;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  floor = buildFloor(canvas.width / W);
}

function bigText(text, size, alpha, y = H / 2) {
  ctx.font = `800 ${size}px Pretendard, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = size / 10;
  ctx.strokeStyle = `rgba(0,0,0,${alpha * 0.5})`;
  ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fillText(text, W / 2, y);
}

function draw(t) {
  const s = canvas.width / W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (floor) ctx.drawImage(floor, 0, 0);
  ctx.setTransform(s, 0, 0, s, 0, 0);

  const moving = phase === "running";
  const sinceReveal = (t - revealAt) / 1000;
  for (const u of units) {
    // Pop in one by one after the reveal.
    let grow = 1;
    if (phase === "betting") {
      const k = Math.max(0, Math.min(1, (sinceReveal - u.delay) / 0.3));
      grow = k + 0.25 * Math.sin(k * Math.PI);
      if (grow <= 0) continue;
    }
    const hop = moving ? Math.abs(Math.sin(t / 140 + u.bob)) * 3 : Math.sin(t / 500 + u.bob) * 1.2;
    const pop = u.flash > 0 ? 1 + u.flash * 1.2 : 1;
    const size = GLYPH * pop * grow;
    const tilt = moving ? Math.sin(t / 180 + u.bob) * 0.12 : 0;

    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath();
    ctx.ellipse(u.x + 2, u.y + size * 0.42, size * 0.34, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(u.x, u.y - hop);
    ctx.rotate(tilt);
    ctx.drawImage(sprites[u.type], -size / 2, -size / 2, size, size);
    ctx.restore();

    if (u.flash > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${u.flash * 2.5})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(u.x, u.y - hop, R * (2.6 - u.flash * 2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2.5);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (phase === "idle") {
    const text = !room ? "혼자 하거나 친구랑 방을 만들어 보세요" : mode === "host" ? "친구가 다 들어오면 새 판을 시작하세요" : "방장이 판을 시작하길 기다리는 중...";
    bigText(text, 34, 0.75);
  } else if (phase === "countdown") {
    const n = Math.ceil(countdown);
    const f = countdown - Math.floor(countdown);
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.fillRect(0, 0, W, H);
    if (n >= 1) bigText(String(4 - n), 140 + f * 70, 0.4 + f * 0.6);
  } else if (phase === "betting" && sinceReveal < 2.2) {
    const a = Math.min(1, sinceReveal * 3, (2.2 - sinceReveal) * 2);
    const text = TYPES.map((k) => `${NAMES[k]} ${lineup[k]}`).join("  ·  ");
    ctx.fillStyle = `rgba(0,0,0,${a * 0.45})`;
    ctx.fillRect(0, H / 2 - 50, W, 100);
    bigText(text, 48, a);
  }
  if (goAt > 0 && (t - goAt) < 700) {
    const k = (t - goAt) / 700;
    bigText("GO!", 120 + k * 60, 1 - k);
  }
}

function updateHud() {
  const c = { rock: 0, paper: 0, scissors: 0 };
  for (const u of units) c[u.type]++;
  const total = units.length || 1;
  $("cRock").textContent = c.rock;
  $("cPaper").textContent = c.paper;
  $("cScissors").textContent = c.scissors;
  const segs = $("popBar").children;
  TYPES.forEach((t, i) => (segs[i].style.width = units.length ? (c[t] / total) * 100 + "%" : "0"));
  $("timer").textContent = `${clock.toFixed(1)}초` + (clock > SUDDEN_DEATH_AT ? " 🔥" : "");
}

// ---------- Sound ----------
let audio = null;
let lastBeep = 0;
function beep(freq, len, type) {
  if (!$("sound").checked) return;
  const now = performance.now();
  if (now - lastBeep < 45) return;
  lastBeep = now;
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.06, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + len);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + len);
  } catch {}
}

// ---------- Main loop ----------
let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (phase === "countdown") {
    const before = Math.ceil(countdown);
    countdown -= dt;
    if (Math.ceil(countdown) !== before && countdown > 0) beep(520, 0.12, "sine");
    if (countdown <= 0 && before > 0) beep(780, 0.2, "triangle");
    if (countdown <= 0 && mode !== "guest") reveal(); // a guest waits for the host's lineup
  } else if (phase === "running") {
    if (mode === "guest") {
      followHost(dt);
    } else {
      const sub = speed * 2;
      for (let i = 0; i < sub && phase === "running"; i++) step(dt / 2);
      if (room && phase === "running" && t - lastSnap >= SNAP_EVERY) {
        lastSnap = t;
        room.send({ t: "snap", c: Math.round(clock * 10) / 10, u: packUnits(units) });
      }
    }
    updateHud();
  } else if (phase === "done") {
    stepParticles(dt);
  }
  draw(t);
  requestAnimationFrame(frame);
}

// ---------- Wiring ----------
$("betAmount").addEventListener("input", refreshBet);
for (const btn of document.querySelectorAll(".pick")) {
  btn.addEventListener("click", () => { pick = btn.dataset.type; refreshBet(); });
}
document.querySelectorAll("[data-add]").forEach((b) =>
  b.addEventListener("click", () => {
    $("betAmount").value = Math.min(save.coins, Math.floor(+$("betAmount").value || 0) + +b.dataset.add);
    refreshBet();
  }));
document.querySelector("[data-half]").addEventListener("click", () => { $("betAmount").value = Math.floor(save.coins / 2); refreshBet(); });
document.querySelector("[data-all]").addEventListener("click", () => { $("betAmount").value = save.coins; refreshBet(); });
$("solo").addEventListener("click", playSolo);
$("hostRoom").addEventListener("click", hostRoom);
$("joinRoom").addEventListener("click", joinRoom);
$("joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
$("myName").addEventListener("change", setName);
$("newRound").addEventListener("click", newRound);
$("start").addEventListener("click", onStartClick);
$("again").addEventListener("click", newRound);
$("leave").addEventListener("click", () => leaveRoom());
$("leave2").addEventListener("click", () => leaveRoom());
$("bailout").addEventListener("click", () => {
  save.coins += BAILOUT;
  persist();
  refreshWallet();
  refreshBet();
});
document.querySelectorAll(".speed-btn").forEach((b) =>
  b.addEventListener("click", () => {
    speed = +b.dataset.speed;
    document.querySelectorAll(".speed-btn").forEach((x) => x.classList.toggle("active", x === b));
  }));
window.addEventListener("beforeunload", () => { if (room) room.close(); });

new ResizeObserver(resize).observe(canvas);
buildSprites();
resize();
$("myName").value = save.name || "";
if (+$("betAmount").value > save.coins) $("betAmount").value = save.coins;
refreshWallet();
updateHud();
requestAnimationFrame(frame);
