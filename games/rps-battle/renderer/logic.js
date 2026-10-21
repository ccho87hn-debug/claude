// Pure game rules, shared by the renderer (as a plain script) and the node tests (as a CommonJS module).
(function (root) {
  const TYPES = ["rock", "paper", "scissors"];
  // BEATS[a] is the type that a turns into a copy of itself.
  const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
  const NAMES = { rock: "바위", paper: "보자기", scissors: "가위" };
  const EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };

  // When two different types touch, returns the type both end up as.
  function clash(a, b) {
    if (a === b) return a;
    return BEATS[a] === b ? a : b;
  }

  // Payout multiplier for betting on `type`: the rarer it starts, the more it pays (with a 10% house edge).
  function odds(counts, type) {
    const total = TYPES.reduce((s, t) => s + (counts[t] || 0), 0);
    const n = counts[type] || 0;
    if (n === 0 || n === total) return 0;
    return Math.max(1.1, Math.floor((total / n) * 0.9 * 10) / 10);
  }

  function payout(bet, counts, type) {
    return Math.floor(bet * odds(counts, type));
  }

  // Why the current setup can't start yet, or "" when it can.
  function validate({ counts, pick, bet, coins }) {
    const alive = TYPES.filter((t) => counts[t] > 0).length;
    if (alive < 2) return "최소 두 종류는 넣어야 해요.";
    if (!pick) return "이길 것 같은 쪽을 골라 주세요.";
    if (!counts[pick]) return "0마리인 쪽에는 걸 수 없어요.";
    if (!Number.isInteger(bet) || bet < 0) return "코인은 0 이상 정수로 걸어 주세요.";
    if (bet > coins) return "가진 코인보다 많이 걸 수 없어요.";
    return "";
  }

  // A fresh lineup for a round: every type shows up, between MIN and MAX of each.
  const LINEUP_MIN = 3;
  const LINEUP_MAX = 25;
  function randomLineup(rand = Math.random) {
    const c = {};
    for (const t of TYPES) c[t] = LINEUP_MIN + Math.floor(rand() * (LINEUP_MAX - LINEUP_MIN + 1));
    return c;
  }

  // What a player gets back from a finished round. `delta` is the change against before the bet was placed.
  function settle({ pick, bet }, lineup, winner) {
    const won = pick === winner;
    const returned = won ? payout(bet, lineup, pick) : 0;
    return { won, returned, delta: returned - bet };
  }

  // Room codes skip look-alike characters (0/O, 1/I/L) so they are easy to read out loud.
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function makeRoomCode(rand = Math.random) {
    let code = "";
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
    return code;
  }
  function normalizeCode(text) {
    return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // Network snapshots: units flattened to [x, y, typeIndex, ...] with whole-number positions.
  function packUnits(units) {
    const out = new Array(units.length * 3);
    units.forEach((u, i) => {
      out[i * 3] = Math.round(u.x);
      out[i * 3 + 1] = Math.round(u.y);
      out[i * 3 + 2] = TYPES.indexOf(u.type);
    });
    return out;
  }
  function unpackUnits(flat) {
    const units = [];
    for (let i = 0; i + 2 < flat.length; i += 3) units.push({ x: flat[i], y: flat[i + 1], type: TYPES[flat[i + 2]] });
    return units;
  }

  function survivors(units) {
    const left = new Set(units.map((u) => u.type));
    return left.size === 1 ? [...left][0] : null;
  }

  const api = { TYPES, BEATS, NAMES, EMOJI, clash, odds, payout, validate, randomLineup, LINEUP_MIN, LINEUP_MAX, settle, makeRoomCode, normalizeCode, packUnits, unpackUnits, survivors };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RPS = api;
})(this);
