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

  // A bet slip is coins per side, e.g. { rock: 100, paper: 0, scissors: 50 }; several sides can be backed at once.
  const emptySlip = () => ({ rock: 0, paper: 0, scissors: 0 });
  const slipTotal = (slip) => TYPES.reduce((s, t) => s + (slip[t] || 0), 0);

  // Takes a slip from the network and keeps only sane whole amounts.
  function cleanSlip(raw) {
    const slip = emptySlip();
    for (const t of TYPES) {
      const n = Math.floor(Number(raw && raw[t]));
      if (n > 0) slip[t] = n;
    }
    return slip;
  }

  // Why this slip can't be placed, or "" when it can.
  function validateSlip({ counts, slip, coins }) {
    for (const t of TYPES) {
      const n = slip[t] || 0;
      if (!Number.isInteger(n) || n < 0) return "코인은 0 이상 정수로 걸어 주세요.";
      if (n > 0 && !odds(counts, t)) return "0마리인 쪽에는 걸 수 없어요.";
    }
    const total = slipTotal(slip);
    if (total === 0) return "한 곳 이상에 코인을 걸어 주세요. 안 걸 거면 구경하기를 눌러요.";
    if (total > coins) return "가진 코인보다 많이 걸 수 없어요.";
    return "";
  }

  // Quick-bet buttons: a share of the wallet, never more than what the other sides leave free.
  function quickAmount(kind, coins, others) {
    const free = Math.max(0, coins - others);
    const want = { third: Math.floor(coins / 3), half: Math.floor(coins / 2), all: free }[kind];
    return Math.min(free, want || 0);
  }

  // A fresh lineup for a round: every type shows up, between MIN and MAX of each.
  const LINEUP_MIN = 3;
  const LINEUP_MAX = 25;
  function randomLineup(rand = Math.random) {
    const c = {};
    for (const t of TYPES) c[t] = LINEUP_MIN + Math.floor(rand() * (LINEUP_MAX - LINEUP_MIN + 1));
    return c;
  }

  // What a slip pays when `winner` is the last type standing. `delta` is the change against before betting.
  function settle(slip, lineup, winner) {
    const total = slipTotal(slip);
    const returned = payout(slip[winner] || 0, lineup, winner);
    return { total, returned, delta: returned - total, won: returned > 0 };
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

  const api = { TYPES, BEATS, NAMES, EMOJI, clash, odds, payout, emptySlip, slipTotal, cleanSlip, validateSlip, quickAmount, randomLineup, LINEUP_MIN, LINEUP_MAX, settle, makeRoomCode, normalizeCode, packUnits, unpackUnits, survivors };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RPS = api;
})(this);
