// Pure game rules, shared by the renderer (as a plain script) and the node tests (as a CommonJS module).
(function (root) {
  const TYPES = ["rock", "paper", "scissors"];
  // BEATS[a] is the type that a turns into a copy of itself.
  const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
  const NAMES = { rock: "주먹", paper: "보자기", scissors: "가위" };
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

  function survivors(units) {
    const left = new Set(units.map((u) => u.type));
    return left.size === 1 ? [...left][0] : null;
  }

  const api = { TYPES, BEATS, NAMES, EMOJI, clash, odds, payout, validate, survivors };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RPS = api;
})(this);
