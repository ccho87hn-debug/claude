const { TYPES, NAMES, SKINS, skinById, buySkin, clash, odds, payout, emptySlip, slipTotal, cleanSlip, validateSlip, quickAmount, randomLineup, settle, normalizeCode, packUnits, unpackUnits, survivors } = window.RPS;

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
    if (s && Number.isInteger(s.coins)) return withSkins({ wins: 0, losses: 0, best: 0, ...s });
  } catch {}
  return withSkins({ coins: START_COINS, wins: 0, losses: 0, best: 0 });
}
// Everyone owns the free skin; a skin that isn't owned can't stay equipped.
function withSkins(s) {
  s.skins = { ...(s.skins || {}), classic: true };
  if (!s.skins[s.skin]) s.skin = "classic";
  return s;
}
let save = loadSave();
let account = false; // signed in with Firebase: coins live on the account instead of this computer
function persist() {
  if (account) { Account.save(save); return; }
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
let slip = emptySlip(); // my coins per side while betting
let focus = null; // the side the amount box is editing
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
let roomBets = {}; // id -> { slip } or { watch: true }, once that player is ready this round
let locked = false; // a guest has sent their bet (or chose to watch)
let staked = 0; // coins taken from my wallet this round, refunded if the room drops before the end
let lastSnap = 0;

// ---------- Sprites: each hand is pre-drawn once at high resolution, in the equipped skin ----------
let sprites = {};
const glyph = (t) => skinById(save.skin).glyphs[t];

function drawSkin(skin, t, px) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = skin.glyphs[t];
  if (skin.style === "text") {
    // Big team-coloured letters with a white rim so they read like the hands do.
    g.font = `900 ${Math.round(px * (text.length > 1 ? 0.5 : 0.72))}px Pretendard, "Segoe UI", sans-serif`;
    g.lineJoin = "round";
    g.lineWidth = px * 0.09;
    g.strokeStyle = "#fff";
    g.strokeText(text, px / 2, px / 2 + px * 0.04);
    g.fillStyle = COLORS[t];
    g.fillText(text, px / 2, px / 2 + px * 0.04);
    return c;
  }
  g.font = `${Math.round(px * 0.8)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  const draw = () => g.fillText(text, px / 2, px / 2 + px * 0.04);
  if (skin.style === "emoji") {
    // Real-object emoji keep their own colours; a team-colour glow says which side they're on.
    g.shadowColor = COLORS[t];
    g.shadowBlur = px * 0.12;
    g.font = `${Math.round(px * 0.7)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    draw();
    draw();
    return c;
  }
  // Recolour the hand in its team colour but keep the emoji's shading and outline:
  // draw it in grey, multiply by the colour, then cut back to the hand's own shape.
  g.filter = "grayscale(1) brightness(1.35) contrast(1.1)";
  draw();
  g.filter = "none";
  g.globalCompositeOperation = "multiply";
  g.fillStyle = COLORS[t];
  g.fillRect(0, 0, px, px);
  g.globalCompositeOperation = "destination-in";
  draw();
  g.globalCompositeOperation = "source-over";
  return c;
}

function buildSprites() {
  const skin = skinById(save.skin);
  sprites = {};
  for (const t of TYPES) sprites[t] = drawSkin(skin, t, GLYPH * 3);
  document.querySelectorAll("[data-glyph]").forEach((e) => (e.textContent = skin.glyphs[e.dataset.glyph]));
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
  for (const p of ["lobbyPanel", "shopPanel", "roomPanel", "countPanel", "betPanel", "livePanel"]) $(p).classList.toggle("hidden", p !== id);
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
    const sides = b && !b.watch ? TYPES.filter((t) => b.slip[t] > 0) : [];
    const what = !b ? "고르는 중..." : b.watch ? "👀 구경" : sides.map((t) => `${glyph(t)} ${b.slip[t].toLocaleString()}`).join(" · ");
    return el("div", { className: "room-bet " + (sides.length === 1 ? sides[0] : b ? "ready" : "") }, el("b", { textContent: m.name }), el("span", { textContent: what }));
  });
}

function refreshBet() {
  if (!lineup) return;
  $("lRock").textContent = lineup.rock;
  $("lPaper").textContent = lineup.paper;
  $("lScissors").textContent = lineup.scissors;
  for (const btn of document.querySelectorAll(".pick")) {
    const t = btn.dataset.type;
    const o = odds(lineup, t);
    btn.querySelector(".odds").textContent = o ? `x${o}` : "-";
    btn.querySelector(".stake").textContent = slip[t] ? `🪙 ${slip[t].toLocaleString()}` : "";
    btn.disabled = !o || locked;
    btn.classList.toggle("selected", t === focus);
    btn.classList.toggle("staked", slip[t] > 0);
  }
  $("amountTitle").textContent = focus ? `${glyph(focus)} ${NAMES[focus]}에 걸 코인` : "위에서 걸 곳을 먼저 눌러요";
  const amount = $("betAmount");
  if (document.activeElement !== amount) amount.value = focus ? slip[focus] : "";
  document.querySelectorAll(".bet input, .bet button").forEach((e) => (e.disabled = locked || !focus));

  const total = slipTotal(slip);
  const err = validateSlip({ counts: lineup, slip, coins: save.coins });
  const hint = $("hint");
  hint.classList.toggle("warn", !!err && total > 0 && !locked);
  if (locked) hint.textContent = roomBets[myId] && roomBets[myId].watch ? "구경하기로 했어요. 방장이 곧 시작해요." : "다 준비되면 방장이 배틀을 시작해요.";
  else if (total === 0) hint.textContent = "여러 곳에 나눠 걸 수도 있어요.";
  else if (err) hint.textContent = err;
  else {
    const wins = TYPES.filter((t) => slip[t] > 0).map((t) => `${glyph(t)} 이기면 🪙 ${payout(slip[t], lineup, t).toLocaleString()}`);
    hint.textContent = `합계 🪙 ${total.toLocaleString()} · ` + wins.join(" / ");
  }

  const start = $("start"), watch = $("watch");
  if (mode === "guest") {
    start.textContent = locked ? "다시 고르기" : "이걸로 걸기";
    start.disabled = !locked && !!err;
    watch.classList.toggle("hidden", locked);
  } else {
    const others = members.filter((m) => m.id !== myId);
    const waiting = others.filter((m) => !roomBets[m.id]).length;
    start.textContent = waiting ? `친구 ${waiting}명이 아직 고르는 중...` : "배틀 시작!";
    start.disabled = waiting > 0 || !!err;
    watch.textContent = mode === "solo" ? "구경하기" : "구경하면서 시작";
    watch.disabled = waiting > 0;
    watch.classList.remove("hidden");
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
  slip = emptySlip();
  focus = null;
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

// Start (solo/host) or send my slip (guest). A locked guest presses it again to change their mind.
function onStartClick() {
  if (mode === "guest") {
    if (locked) {
      locked = false;
      room.send({ t: "unbet" });
    } else {
      if (validateSlip({ counts: lineup, slip, coins: save.coins })) return;
      locked = true;
      room.send({ t: "bet", slip });
    }
    refreshBet();
    return;
  }
  if (validateSlip({ counts: lineup, slip, coins: save.coins }) || !everyoneReady()) return;
  roomBets[myId] = { slip: { ...slip } };
  launch();
}

function onWatchClick() {
  if (mode === "guest") {
    locked = true;
    room.send({ t: "bet", watch: true });
    roomBets[myId] = { watch: true };
    refreshBet();
    return;
  }
  if (!everyoneReady()) return;
  roomBets[myId] = { watch: true };
  launch();
}

const everyoneReady = () => members.every((m) => m.id === myId || roomBets[m.id]);

function launch() {
  if (room) room.send({ t: "go", bets: roomBets });
  go();
}

function go() {
  const mine = roomBets[myId];
  const betting = mine && !mine.watch;
  staked = betting ? slipTotal(mine.slip) : 0;
  save.coins -= staked;
  persist();
  phase = "running";
  goAt = performance.now();
  lastSnap = 0;
  beep(1040, 0.15, "sine");
  showPanel("livePanel");
  $("liveBet").innerHTML = !betting
    ? "이번 판은 구경 중이에요."
    : TYPES.filter((t) => mine.slip[t] > 0)
      .map((t) => `${glyph(t)} <b>${NAMES[t]}</b> 🪙 ${mine.slip[t].toLocaleString()} → 이기면 🪙 ${payout(mine.slip[t], lineup, t).toLocaleString()}`)
      .join("<br>");
  $("liveBets").replaceChildren(...(mode === "solo" ? [] : betRows()));
  $("speedRow").classList.toggle("hidden", mode === "guest");
  refreshWallet();
}

function outcomeText(r) {
  if (!r) return "구경";
  if (r.won && r.delta >= 0) return `+🪙 ${r.delta.toLocaleString()}`;
  return `-🪙 ${(-r.delta).toLocaleString()}`;
}

function finishRound(winner) {
  phase = "done";
  if (mode === "host") room.send({ t: "end", winner });
  for (const u of units) u.type = winner;
  const mine = roomBets[myId];
  const r = mine && !mine.watch ? settle(mine.slip, lineup, winner) : null;
  staked = 0;
  if (r) {
    save.coins += r.returned;
    if (r.delta > 0) { save.wins++; save.best = Math.max(save.best, r.delta); } else save.losses++;
    persist();
  }
  refreshWallet();
  updateHud();
  $("resultEmoji").textContent = glyph(winner);
  $("resultTitle").textContent = `${NAMES[winner]} 최종 승리!`;
  const rc = $("resultCoins");
  rc.className = "result-coins " + (r && r.delta > 0 ? "win" : "lose");
  if (!r) rc.textContent = "구경 끝!";
  else if (r.delta > 0) rc.textContent = `적중! +🪙 ${r.delta.toLocaleString()}`;
  else if (r.won) rc.textContent = `적중했지만 -🪙 ${(-r.delta).toLocaleString()}`;
  else rc.textContent = `꽝! -🪙 ${r.total.toLocaleString()}`;
  // Everyone else's outcome, online only.
  const others = mode === "solo" ? [] : members.filter((m) => m.id !== myId && roomBets[m.id]);
  $("resultLines").replaceChildren(...others.map((m) => {
    const b = roomBets[m.id];
    const o = b.watch ? null : settle(b.slip, lineup, winner);
    return el("div", { className: "result-line " + (!o ? "" : o.delta > 0 ? "win" : "lose") },
      el("b", { textContent: m.name }), el("span", { textContent: outcomeText(o) }));
  }));
  $("again").classList.toggle("hidden", mode === "guest");
  $("resultWait").classList.toggle("hidden", mode !== "guest");
  $("result").classList.remove("hidden");
  const good = r && r.delta > 0;
  beep(good ? 880 : 220, 0.25, good ? "triangle" : "sawtooth");
}

// ---------- Accounts ----------
function authMessage(text, warn = false) {
  const m = $("authMsg");
  m.textContent = text;
  m.classList.toggle("warn", warn);
}

function enterAccount(profile) {
  account = true;
  save = withSkins({
    name: profile.name,
    coins: Number.isInteger(profile.coins) ? profile.coins : 0,
    wins: profile.wins || 0, losses: profile.losses || 0, best: profile.best || 0,
    skins: profile.skins, skin: profile.skin,
  });
  $("authPass").value = $("authPass2").value = "";
  $("authScreen").classList.add("hidden");
  buildSprites();
  showLobby();
}

let signupMode = false;
function setAuthMode(signup) {
  signupMode = signup;
  $("tabLogin").classList.toggle("active", !signup);
  $("tabSignup").classList.toggle("active", signup);
  $("pass2Row").classList.toggle("hidden", !signup);
  $("authSubmit").textContent = signup ? "가입하고 시작하기" : "로그인";
  $("authPass").autocomplete = signup ? "new-password" : "current-password";
  authMessage("");
}

function showLobby() {
  $("meRow").classList.toggle("hidden", !account);
  $("guestName").classList.toggle("hidden", account);
  $("meName").textContent = save.name;
  $("myName").value = save.name || "";
  lobbyMessage("");
  showPanel("lobbyPanel");
  refreshWallet();
}

async function authAction() {
  const name = $("authName").value.trim();
  const password = $("authPass").value;
  const bad = window.Account ? Account.checkInput(name, password) : "로그인 기능을 불러오지 못했어요.";
  if (bad) { authMessage(bad, true); return; }
  if (signupMode && password !== $("authPass2").value) { authMessage("비밀번호 확인이 달라요.", true); return; }
  authMessage(signupMode ? "가입하는 중이에요..." : "로그인하는 중이에요...");
  $("authSubmit").disabled = true;
  try {
    enterAccount(await (signupMode ? Account.signUp(name, password) : Account.logIn(name, password)));
    authMessage("");
  } catch (e) {
    authMessage(e.message, true);
  } finally {
    $("authSubmit").disabled = false;
  }
}

async function logOut() {
  if (room) leaveRoom();
  await Account.logOut();
  account = false;
  save = loadSave();
  buildSprites();
  setAuthMode(false);
  authMessage("로그아웃했어요.");
  $("authScreen").classList.remove("hidden");
  refreshWallet();
}

// ---------- Skin shop ----------
function openShop() {
  $("shopMsg").textContent = "";
  renderShop();
  showPanel("shopPanel");
}

function renderShop() {
  $("skinList").replaceChildren(...SKINS.map((skin) => {
    const preview = el("canvas", { width: 360, height: 120 });
    const g = preview.getContext("2d");
    TYPES.forEach((t, i) => g.drawImage(drawSkin(skin, t, 120), i * 120, 0, 120, 120));
    const owned = save.skins[skin.id];
    const equipped = save.skin === skin.id;
    const action = el("button", {
      className: equipped ? "ghost" : owned ? "ghost" : "primary",
      textContent: equipped ? "쓰는 중" : owned ? "쓰기" : `🪙 ${skin.price.toLocaleString()}`,
      disabled: equipped,
      onclick: () => (owned ? equip(skin.id) : buy(skin.id)),
    });
    return el("div", { className: "skin" + (equipped ? " equipped" : "") },
      preview,
      el("div", {}, el("b", { textContent: skin.name }),
        el("small", { textContent: TYPES.map((t) => `${NAMES[t]} ${skin.glyphs[t]}`).join(" · ") })),
      action);
  }));
}

function buy(id) {
  const r = buySkin(save, id);
  const msg = $("shopMsg");
  msg.classList.toggle("warn", !!r.error);
  if (r.error) { msg.textContent = r.error; return; }
  save.coins = r.coins;
  save.skins = r.skins;
  msg.textContent = `${skinById(id).name} 스킨을 샀어요!`;
  equip(id);
}

function equip(id) {
  if (!save.skins[id]) return;
  save.skin = id;
  persist();
  buildSprites();
  refreshWallet();
  renderShop();
}

async function restoreLogin() {
  if (!window.Account) { authMessage("로그인 기능을 불러오지 못했어요. 로그인 없이 할 수 있어요.", true); return; }
  try {
    const profile = await Account.restore();
    if (profile) { enterAccount(profile); return; }
  } catch {}
  authMessage("");
  $("authName").focus();
}

// ---------- Lobby and rooms ----------
function lobbyMessage(text, warn = false) {
  const m = $("lobbyMsg");
  m.textContent = text;
  m.classList.toggle("warn", warn);
}

function setName() {
  if (account) return save.name;
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
    if (msg.watch) roomBets[from] = { watch: true };
    else {
      const s = cleanSlip(msg.slip);
      if (!slipTotal(s) || TYPES.some((t) => s[t] > 0 && !odds(lineup, t))) return;
      roomBets[from] = { slip: s };
    }
    room.send({ t: "bets", bets: roomBets });
    refreshBet();
  } else if (msg.t === "unbet" && phase === "betting") {
    delete roomBets[from];
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
const others = () => slipTotal(slip) - (slip[focus] || 0);
function setStake(n) {
  if (!focus) return;
  slip[focus] = Math.max(0, Math.min(Math.floor(n) || 0, save.coins - others()));
  refreshBet();
}
$("betAmount").addEventListener("input", () => {
  if (!focus) return;
  slip[focus] = Math.max(0, Math.floor(+$("betAmount").value) || 0);
  refreshBet();
});
$("betAmount").addEventListener("blur", () => setStake(slip[focus]));
for (const btn of document.querySelectorAll(".pick")) {
  btn.addEventListener("click", () => {
    focus = btn.dataset.type;
    if (!slip[focus]) setStake(100); // a first tap on a side puts 100 on it; "0" takes it off
    refreshBet();
  });
}
document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => setStake(slip[focus] + +b.dataset.add)));
document.querySelectorAll("[data-share]").forEach((b) =>
  b.addEventListener("click", () => setStake(quickAmount(b.dataset.share, save.coins, others()))));
document.querySelector("[data-clear]").addEventListener("click", () => setStake(0));
$("watch").addEventListener("click", onWatchClick);
$("authForm").addEventListener("submit", (e) => { e.preventDefault(); authAction(); });
$("tabLogin").addEventListener("click", () => setAuthMode(false));
$("tabSignup").addEventListener("click", () => setAuthMode(true));
$("noLogin").addEventListener("click", () => {
  account = false;
  save = loadSave();
  $("authScreen").classList.add("hidden");
  buildSprites();
  showLobby();
});
$("openShop").addEventListener("click", openShop);
$("closeShop").addEventListener("click", showLobby);
$("logOut").addEventListener("click", logOut);
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
document.fonts.load('900 40px Pretendard').then(buildSprites).catch(() => {});
resize();
refreshWallet();
updateHud();
restoreLogin();
requestAnimationFrame(frame);
