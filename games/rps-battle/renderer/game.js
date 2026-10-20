const { TYPES, NAMES, EMOJI, clash, odds, payout, validate, survivors } = window.RPS;

// ---------- Arena constants (logical units; the canvas scales them to fit) ----------
const W = 900;
const H = 600;
const R = 15;
const BASE_SPEED = 105;
const STEER = 160;
const SUDDEN_DEATH_AT = 60; // seconds; after this, everyone speeds up so a round always ends
const COLORS = { rock: "#ef6b5b", paper: "#4fa3f7", scissors: "#f5c242" };
const START_COINS = 1000;
const BAILOUT = 500;

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

// ---------- Round state ----------
let units = [];
let particles = [];
let phase = "setup"; // setup | countdown | running | done
let pick = null;
let bet = 0;
let startCounts = null;
let clock = 0;
let countdown = 0;
let speed = 1;
let previewKey = "";

// ---------- Sprites: each type is pre-drawn once at high resolution ----------
const sprites = {};
function buildSprites() {
  const px = Math.ceil(R * 2 * 3);
  for (const t of TYPES) {
    const c = document.createElement("canvas");
    c.width = c.height = px + 8;
    const g = c.getContext("2d");
    const cx = c.width / 2;
    const r = px / 2;
    const grad = g.createRadialGradient(cx - r * 0.35, cx - r * 0.35, r * 0.1, cx, cx, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.25, COLORS[t]);
    grad.addColorStop(1, shade(COLORS[t], -0.35));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cx, r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(255,255,255,.85)";
    g.stroke();
    g.font = `${Math.round(r * 1.15)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(EMOJI[t], cx, cx + r * 0.08);
    sprites[t] = c;
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + v * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------- Setup ----------
function counts() {
  return { rock: +$("nRock").value, paper: +$("nPaper").value, scissors: +$("nScissors").value };
}

// Scatter units across the arena without overlaps (gives up after a few tries per unit when crowded).
function spawn(c) {
  const list = [];
  for (const t of TYPES) {
    for (let i = 0; i < c[t]; i++) {
      let x, y, tries = 0;
      do {
        x = R + 10 + Math.random() * (W - 2 * R - 20);
        y = R + 10 + Math.random() * (H - 2 * R - 20);
      } while (tries++ < 40 && list.some((u) => (u.x - x) ** 2 + (u.y - y) ** 2 < (R * 2.4) ** 2));
      const a = Math.random() * Math.PI * 2;
      list.push({ x, y, vx: Math.cos(a) * BASE_SPEED, vy: Math.sin(a) * BASE_SPEED, type: t, flash: 0, bob: Math.random() * 6 });
    }
  }
  return list;
}

function refreshSetup() {
  const c = counts();
  if (pick && !odds(c, pick)) pick = null;
  $("oRock").textContent = c.rock;
  $("oPaper").textContent = c.paper;
  $("oScissors").textContent = c.scissors;
  for (const btn of document.querySelectorAll(".pick")) {
    const o = odds(c, btn.dataset.type);
    btn.querySelector(".odds").textContent = o ? `x${o}` : "-";
    btn.disabled = !o;
    btn.classList.toggle("selected", btn.dataset.type === pick);
  }
  const b = Math.floor(+$("betAmount").value);
  const err = validate({ counts: c, pick, bet: b, coins: save.coins });
  const hint = $("hint");
  hint.classList.toggle("warn", !!err);
  if (err) hint.textContent = err;
  else if (b === 0) hint.textContent = "0코인이면 구경만 해요.";
  else hint.textContent = `이기면 🪙 ${payout(b, c, pick).toLocaleString()} 받아요.`;
  $("start").disabled = !!err;
  const key = TYPES.map((t) => c[t]).join(",");
  if (phase === "setup" && key !== previewKey) {
    previewKey = key;
    units = spawn(c);
    updateHud();
  }
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

function startRound() {
  const c = counts();
  bet = Math.floor(+$("betAmount").value);
  if (validate({ counts: c, pick, bet, coins: save.coins })) return;
  save.coins -= bet;
  persist();
  startCounts = c;
  units = spawn(c);
  particles = [];
  clock = 0;
  countdown = 3;
  phase = "countdown";
  $("setupPanel").classList.add("hidden");
  $("livePanel").classList.remove("hidden");
  $("result").classList.add("hidden");
  $("liveBet").innerHTML = bet
    ? `${EMOJI[pick]} <b>${NAMES[pick]}</b>에 🪙 ${bet.toLocaleString()} 걸었어요<br>배당 x${odds(c, pick)} · 이기면 🪙 ${payout(bet, c, pick).toLocaleString()}`
    : `${EMOJI[pick]} <b>${NAMES[pick]}</b> 응원 중 (구경 모드)`;
  refreshWallet();
  updateHud();
}

function finishRound(winner) {
  phase = "done";
  const won = winner === pick;
  let delta;
  if (won) {
    const gain = payout(bet, startCounts, pick);
    save.coins += gain;
    delta = gain - bet;
    if (bet > 0) save.wins++;
    save.best = Math.max(save.best, delta);
  } else {
    delta = -bet;
    if (bet > 0) save.losses++;
  }
  persist();
  refreshWallet();
  $("resultEmoji").textContent = EMOJI[winner];
  $("resultTitle").textContent = `${NAMES[winner]} 최종 승리!`;
  const rc = $("resultCoins");
  rc.className = "result-coins " + (won ? "win" : "lose");
  if (bet === 0) rc.textContent = won ? "응원 성공! 🎉" : "아쉽네요!";
  else rc.textContent = won ? `적중! +🪙 ${delta.toLocaleString()}` : `꽝! -🪙 ${bet.toLocaleString()}`;
  $("result").classList.remove("hidden");
  beep(won ? 880 : 220, 0.25, won ? "triangle" : "sawtooth");
}

function backToSetup() {
  phase = "setup";
  previewKey = "";
  clock = 0;
  particles = [];
  $("result").classList.add("hidden");
  $("livePanel").classList.add("hidden");
  $("setupPanel").classList.remove("hidden");
  const b = $("betAmount");
  if (+b.value > save.coins) b.value = save.coins;
  refreshWallet();
  refreshSetup();
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

  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);

  clock += dt;
  const winner = survivors(units);
  if (winner) finishRound(winner);
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
  bg.addColorStop(0, "#2b5d45");
  bg.addColorStop(1, "#173426");
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

function draw(t) {
  const s = canvas.width / W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (floor) ctx.drawImage(floor, 0, 0);
  ctx.setTransform(s, 0, 0, s, 0, 0);

  const moving = phase === "running";
  for (const u of units) {
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(u.x + 3, u.y + 6, R * 0.95, R * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const u of units) {
    const hop = moving ? Math.abs(Math.sin(t / 140 + u.bob)) * 2.5 : 0;
    const pop = u.flash > 0 ? 1 + u.flash * 1.2 : 1;
    const size = R * 2 * pop;
    ctx.drawImage(sprites[u.type], u.x - size / 2 - 1, u.y - size / 2 - hop - 1, size + 2, size + 2);
    if (u.flash > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${u.flash * 2.5})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(u.x, u.y - hop, R * (2.4 - u.flash * 2), 0, Math.PI * 2);
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

  if (phase === "countdown") {
    const n = Math.ceil(countdown);
    const f = countdown - Math.floor(countdown);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, 0, W, H);
    ctx.font = `800 ${120 + f * 60}px Pretendard, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(255,255,255,${0.4 + f * 0.6})`;
    ctx.fillText(n > 0 ? n : "GO!", W / 2, H / 2);
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
  TYPES.forEach((t, i) => (segs[i].style.width = (c[t] / total) * 100 + "%"));
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
    if (Math.ceil(countdown) !== before) beep(countdown > 0 ? 520 : 1040, 0.12, "sine");
    if (countdown <= -0.4) phase = "running";
  } else if (phase === "running") {
    const sub = speed * 2;
    for (let i = 0; i < sub && phase === "running"; i++) step(dt / 2);
    updateHud();
  } else if (phase === "done") {
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
  }
  draw(t);
  requestAnimationFrame(frame);
}

// ---------- Wiring ----------
for (const id of ["nRock", "nPaper", "nScissors", "betAmount"]) $(id).addEventListener("input", refreshSetup);
for (const btn of document.querySelectorAll(".pick")) {
  btn.addEventListener("click", () => { pick = btn.dataset.type; refreshSetup(); });
}
$("randomize").addEventListener("click", () => {
  for (const id of ["nRock", "nPaper", "nScissors"]) $(id).value = 3 + Math.floor(Math.random() * 38);
  refreshSetup();
});
document.querySelectorAll("[data-add]").forEach((b) =>
  b.addEventListener("click", () => {
    $("betAmount").value = Math.min(save.coins, Math.floor(+$("betAmount").value || 0) + +b.dataset.add);
    refreshSetup();
  }));
document.querySelector("[data-half]").addEventListener("click", () => { $("betAmount").value = Math.floor(save.coins / 2); refreshSetup(); });
document.querySelector("[data-all]").addEventListener("click", () => { $("betAmount").value = save.coins; refreshSetup(); });
$("start").addEventListener("click", startRound);
$("again").addEventListener("click", backToSetup);
$("bailout").addEventListener("click", () => {
  save.coins += BAILOUT;
  persist();
  refreshWallet();
  refreshSetup();
});
document.querySelectorAll(".speed-btn").forEach((b) =>
  b.addEventListener("click", () => {
    speed = +b.dataset.speed;
    document.querySelectorAll(".speed-btn").forEach((x) => x.classList.toggle("active", x === b));
  }));

new ResizeObserver(resize).observe(canvas);
buildSprites();
resize();
if (+$("betAmount").value > save.coins) $("betAmount").value = save.coins;
refreshWallet();
refreshSetup();
requestAnimationFrame(frame);
