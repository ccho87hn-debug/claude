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

  // Online rounds are a shared pot: every coin bet goes in, and whoever backed the winner splits it all,
  // in proportion to what they put on the winner. If nobody backed the winner, everyone gets their coins back.
  // `slips` is { playerId: slip }; returns { playerId: { total, returned, delta, won } }.
  function settlePot(slips, winner) {
    const ids = Object.keys(slips);
    const pot = ids.reduce((s, id) => s + slipTotal(slips[id]), 0);
    const backed = ids.reduce((s, id) => s + (slips[id][winner] || 0), 0);
    const out = {};
    let paid = 0;
    for (const id of ids) {
      const total = slipTotal(slips[id]);
      const on = slips[id][winner] || 0;
      const returned = backed ? Math.floor((pot * on) / backed) : total;
      paid += returned;
      out[id] = { total, returned, delta: returned - total, won: on > 0 };
    }
    // Rounding leftovers go to the biggest winner (first in order on a tie) so no coin disappears.
    if (backed && pot > paid) {
      const top = ids.reduce((a, b) => ((slips[b][winner] || 0) > (slips[a][winner] || 0) ? b : a));
      out[top].returned += pot - paid;
      out[top].delta += pot - paid;
    }
    return out;
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

  // Skins change how the hands look (only on your own screen). `style` tells the renderer how to draw them:
  // "tint" recolours an emoji in the team colour, "emoji" draws it as-is with a team-colour glow, "text" draws letters.
  const SKINS = [
    { id: "classic", name: "기본 손", price: 0, style: "tint", glyphs: { rock: "✊", paper: "✋", scissors: "✌️" } },
    { id: "numbers", name: "숫자", price: 300, style: "text", glyphs: { rock: "0", paper: "5", scissors: "2" } },
    { id: "objects", name: "진짜 물건", price: 600, style: "emoji", glyphs: { rock: "🪨", paper: "📄", scissors: "✂️" } },
    { id: "mukjjippa", name: "묵찌빠", price: 1000, style: "text", glyphs: { rock: "묵", paper: "빠", scissors: "찌" } },
  ];
  const skinById = (id) => SKINS.find((k) => k.id === id) || SKINS[0];

  // Buying a skin: returns the new { coins, skins } or an error message, without touching the input.
  function buySkin({ coins, skins }, id) {
    const skin = SKINS.find((k) => k.id === id);
    if (!skin) return { error: "없는 스킨이에요." };
    if (skins && skins[id]) return { error: "이미 가진 스킨이에요." };
    if (coins < skin.price) return { error: `코인이 ${(skin.price - coins).toLocaleString()}개 모자라요.` };
    return { coins: coins - skin.price, skins: { ...(skins || {}), [id]: true } };
  }


  // ---------- Stocks ----------
  // Made-up companies. Prices come from the clock alone (same on every computer, and they keep moving while
  // the app is closed): layered smooth noise around a base price, so a stock wanders but never runs away.
  // `vol` is how wild it swings.
  const STOCKS = [
    ["scissors-elec", "가위전자", "📱", 820, 0.9], ["rock-const", "바위건설", "🏗️", 540, 0.7], ["paper-tex", "보자기섬유", "🧵", 310, 0.8],
    ["coin-bank", "코인은행", "🏦", 1250, 0.5], ["mukjjippa", "묵찌빠엔터", "🎤", 460, 1.3], ["hand-motors", "손바닥자동차", "🚗", 980, 0.7],
    ["finger-food", "손가락치킨", "🍗", 270, 0.9], ["fist-gym", "주먹헬스", "🏋️", 190, 1.1], ["victory-air", "브이항공", "✈️", 730, 0.8],
    ["ddakji", "딱지게임즈", "🎮", 640, 1.4], ["gonggi", "공기바이오", "🧬", 1500, 1.6], ["yut", "윷놀이물류", "📦", 350, 0.6],
    ["tteok", "떡볶이푸드", "🌶️", 220, 0.8], ["ramyeon", "라면나라", "🍜", 160, 0.7], ["kimbap", "김밥천하", "🍙", 120, 0.6],
    ["bungeo", "붕어빵제과", "🐟", 90, 1.0], ["hotteok", "호떡에너지", "⚡", 410, 1.2], ["dalgona", "달고나반도체", "💾", 2100, 1.1],
    ["rocket", "로켓우주", "🚀", 3200, 1.8], ["moon", "달나라여행", "🌙", 1800, 1.7], ["robot", "깡통로봇", "🤖", 1100, 1.3],
    ["ai-brain", "똑똑AI", "🧠", 2600, 1.5], ["cloud", "구름통신", "☁️", 870, 0.8], ["wifi", "와이파이텔레콤", "📶", 520, 0.6],
    ["pixel", "픽셀소프트", "🖥️", 760, 1.0], ["meme", "밈코인", "🐶", 40, 2.2], ["cat", "고양이간식", "🐱", 300, 0.9],
    ["dino", "공룡테마파크", "🦖", 690, 1.0], ["ice", "빙수아이스", "🍧", 150, 0.9], ["umbrella", "우산날씨", "☂️", 230, 1.0],
    ["sneaker", "점프신발", "👟", 480, 0.9], ["guitar", "기타뮤직", "🎸", 380, 1.0], ["movie", "팝콘시네마", "🍿", 560, 0.9],
    ["solar", "햇빛발전", "☀️", 940, 1.1], ["battery", "번개배터리", "🔋", 1350, 1.2], ["ship", "고래조선", "🐋", 1020, 0.8],
    ["gold", "황금광산", "⛏️", 1700, 0.6], ["oil", "검은기름", "🛢️", 880, 1.0], ["pharma", "튼튼제약", "💊", 1200, 1.1],
    ["toy", "장난감공장", "🧸", 260, 0.8],
  ].map(([id, name, icon, base, vol]) => ({ id, name, icon, base, vol }));
  const stockById = (id) => STOCKS.find((k) => k.id === id);
  const STOCK_TICK_MS = 5000; // the market moves every 5 seconds
  const TRADE_FEE = 0.01; // 1% on every buy and sell

  function hash01(str, n) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    h = Math.imul(h ^ n, 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // Smooth noise in [-1, 1] that changes gradually over `x`.
  function smooth(key, x) {
    const i = Math.floor(x), f = x - i;
    const a = hash01(key, i) * 2 - 1, b = hash01(key, i + 1) * 2 - 1;
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  }
  const OCTAVES = [[1, 0.015], [4, 0.03], [16, 0.06], [60, 0.12], [240, 0.25], [1000, 0.45]]; // [period in ticks, size]
  function stockPrice(stock, tick) {
    let x = 0;
    for (const [period, size] of OCTAVES) x += smooth(stock.id + period, tick / period) * size;
    return Math.max(1, Math.round(stock.base * Math.exp(x * stock.vol)));
  }
  const stockTick = (now = Date.now()) => Math.floor(now / STOCK_TICK_MS);

  // Holdings are { id: { qty, cost } }, cost being the coins paid in total. Both return new state or { error }.
  function buyStock({ coins, stocks }, id, qty, price) {
    if (!stockById(id)) return { error: "없는 종목이에요." };
    if (!Number.isInteger(qty) || qty <= 0) return { error: "1주 이상 사야 해요." };
    const pay = buyCost(qty, price);
    if (pay > coins) return { error: `코인이 ${(pay - coins).toLocaleString()}개 모자라요.` };
    const had = (stocks && stocks[id]) || { qty: 0, cost: 0 };
    return { coins: coins - pay, stocks: { ...(stocks || {}), [id]: { qty: had.qty + qty, cost: had.cost + pay } }, paid: pay };
  }
  function sellStock({ coins, stocks }, id, qty, price) {
    const had = stocks && stocks[id];
    if (!had || !had.qty) return { error: "가진 주식이 없어요." };
    if (!Number.isInteger(qty) || qty <= 0 || qty > had.qty) return { error: `${had.qty.toLocaleString()}주까지 팔 수 있어요.` };
    const get = qty * price - Math.ceil(qty * price * TRADE_FEE);
    const next = { ...stocks };
    if (qty === had.qty) delete next[id];
    else next[id] = { qty: had.qty - qty, cost: Math.round((had.cost * (had.qty - qty)) / had.qty) };
    return { coins: coins + get, stocks: next, got: get };
  }
  // How many shares `coins` can buy, fee included.
  const buyCost = (qty, price) => qty * price + Math.ceil(qty * price * TRADE_FEE);
  function maxBuy(coins, price) {
    let q = Math.floor(coins / (price * (1 + TRADE_FEE)));
    while (q > 0 && buyCost(q, price) > coins) q--;
    return q;
  }

  // ---------- Loans ----------
  // Instead of free handouts you borrow from the bank. Debt grows 3% every 10 minutes (counted on the clock,
  // so it grows while the app is closed too) until it is paid back.
  const LOAN_LIMIT = 5000;
  const LOAN_RATE = 0.03;
  const LOAN_PERIOD_MS = 10 * 60 * 1000;
  // Brings a loan up to `now`. `debtAt` is when interest was last added.
  function accrueDebt({ debt, debtAt }, now = Date.now()) {
    if (!debt) return { debt: 0, debtAt: now };
    const periods = Math.floor((now - (debtAt || now)) / LOAN_PERIOD_MS);
    if (periods <= 0) return { debt, debtAt };
    return { debt: Math.ceil(debt * Math.pow(1 + LOAN_RATE, periods)), debtAt: debtAt + periods * LOAN_PERIOD_MS };
  }
  function borrow({ coins, debt }, amount) {
    if (!Number.isInteger(amount) || amount <= 0) return { error: "빌릴 코인을 정해 주세요." };
    const room = LOAN_LIMIT - (debt || 0);
    if (amount > room) return { error: room > 0 ? `${room.toLocaleString()}개까지만 더 빌릴 수 있어요.` : "더는 빌릴 수 없어요. 먼저 갚아 주세요." };
    return { coins: coins + amount, debt: (debt || 0) + amount };
  }
  function repay({ coins, debt }, amount) {
    if (!debt) return { error: "갚을 빚이 없어요." };
    const pay = Math.min(amount, debt);
    if (!Number.isInteger(pay) || pay <= 0) return { error: "갚을 코인을 정해 주세요." };
    if (pay > coins) return { error: "가진 코인보다 많이 갚을 수 없어요." };
    return { coins: coins - pay, debt: debt - pay };
  }
  // Last resort when you're broke, own no stocks and can't borrow any more.
  const canGoBankrupt = ({ coins, debt, stocks }) => coins < 10 && (debt || 0) >= LOAN_LIMIT && !Object.keys(stocks || {}).length;

  function survivors(units) {
    const left = new Set(units.map((u) => u.type));
    return left.size === 1 ? [...left][0] : null;
  }

  const api = { TYPES, BEATS, NAMES, EMOJI, clash, odds, payout, emptySlip, slipTotal, cleanSlip, validateSlip, quickAmount, randomLineup, LINEUP_MIN, LINEUP_MAX, settle, settlePot, makeRoomCode, normalizeCode, packUnits, unpackUnits, SKINS, skinById, buySkin, survivors, STOCKS, stockById, STOCK_TICK_MS, TRADE_FEE, stockPrice, stockTick, buyStock, sellStock, maxBuy, LOAN_LIMIT, LOAN_RATE, LOAN_PERIOD_MS, accrueDebt, borrow, repay, canGoBankrupt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RPS = api;
})(this);
