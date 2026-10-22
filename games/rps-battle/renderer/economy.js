// The side menu and the money outside the arena: the stock market and the bank.
// Uses the wallet (`save`, `persist`, `refreshWallet`) and round state from game.js.
(function () {
  const { STOCKS, stockById, stockPrice, stockTick, buyStock, sellStock, maxBuy, TRADE_FEE, LOAN_LIMIT, LOAN_PERIOD_MS, accrueDebt, borrow, repay, canGoBankrupt } = window.RPS;
  const fmt = (n) => Math.round(n).toLocaleString();
  const HOUR = 720; // ticks in an hour

  let view = "game";
  let picked = STOCKS[0].id;
  let filter = "all";
  let range = 360;
  let lastTick = -1;

  // ---------- Menu ----------
  function inRound() {
    return phase === "countdown" || phase === "betting" || phase === "running" || phase === "done";
  }

  function showView(v) {
    if (v !== "game" && room) return; // the room keeps you in the game; leave it first
    if (v !== "game" && inRound()) quitRound(); // walking away from a solo round
    view = v;
    $("layout").classList.toggle("alt-view", v === "stocks" || v === "bank");
    $("stocksView").classList.toggle("hidden", v !== "stocks");
    $("bankView").classList.toggle("hidden", v !== "bank");
    if (v === "shop") openShop();
    else if (v === "game" && !room && !inRound()) showLobby();
    if (v !== "stocks" && v !== "bank") resize(); // the arena may have been hidden while the window changed size
    if (v === "stocks") renderStocks(true);
    if (v === "bank") renderBank();
    refreshNav();
  }

  function refreshNav() {
    document.querySelectorAll(".nav-btn").forEach((b) => {
      const v = b.dataset.view;
      b.classList.toggle("active", v === view || (v === "game" && view === "game"));
      b.disabled = v !== "game" && !!room;
      b.title = b.disabled ? "방에서 나가면 열 수 있어요" : "";
    });
  }

  // ---------- Assets ----------
  function holdingsValue(tick) {
    let v = 0;
    for (const [id, h] of Object.entries(save.stocks || {})) {
      const k = stockById(id);
      if (k) v += h.qty * stockPrice(k, tick);
    }
    return v;
  }

  function assetTiles(tick) {
    const stocks = holdingsValue(tick);
    const total = save.coins + stocks - save.debt;
    const tile = (label, value, cls = "") => el("div", { className: "asset " + cls }, el("small", { textContent: label }), el("b", { textContent: value }));
    return [
      tile("코인", `🪙 ${fmt(save.coins)}`),
      tile("주식", `🪙 ${fmt(stocks)}`),
      tile("빚", save.debt ? `-🪙 ${fmt(save.debt)}` : "없음", save.debt ? "down" : ""),
      tile("총 재산 (코인 + 주식 - 빚)", `🪙 ${fmt(total)}`, "total"),
    ];
  }

  // ---------- Stocks ----------
  function changeText(now, before) {
    const pct = ((now - before) / before) * 100;
    const cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "-";
    return { cls, text: `${arrow} ${Math.abs(pct).toFixed(2)}%` };
  }

  function renderStocks(full = false) {
    const tick = stockTick();
    lastTick = tick;
    $("assetGrid").replaceChildren(...assetTiles(tick));

    const q = $("stockSearch").value.trim();
    const rows = STOCKS.filter((k) => (filter === "all" || (save.stocks[k.id] && save.stocks[k.id].qty)) && (!q || k.name.includes(q)));
    $("stockList").replaceChildren(...(rows.length ? rows.map((k) => {
      const p = stockPrice(k, tick);
      const c = changeText(p, stockPrice(k, tick - HOUR));
      const own = save.stocks[k.id];
      return el("button", { className: "stock-row" + (k.id === picked ? " active" : ""), onclick: () => { picked = k.id; $("tradeMsg").textContent = ""; renderStocks(true); } },
        el("span", { className: "ic", textContent: k.icon }),
        el("span", {}, el("b", { textContent: k.name }), el("small", { textContent: own ? `${fmt(own.qty)}주 가지고 있음` : "" })),
        el("span", { className: "px" }, el("span", { textContent: `🪙 ${fmt(p)}` }), el("small", { className: c.cls, textContent: c.text })));
    }) : [el("p", { className: "hint", textContent: filter === "mine" ? "아직 가진 주식이 없어요." : "그런 종목이 없어요." })]));

    const k = stockById(picked);
    const p = stockPrice(k, tick);
    const c = changeText(p, stockPrice(k, tick - HOUR));
    $("sIcon").textContent = k.icon;
    $("sName").textContent = k.name;
    $("sPrice").textContent = `🪙 ${fmt(p)}`;
    $("sChange").className = c.cls;
    $("sChange").textContent = `${c.text} (1시간 전보다)`;
    const own = save.stocks[picked];
    if (own) {
      const value = own.qty * p;
      const gain = value - own.cost;
      $("sMine").innerHTML = `가진 주식 <b>${fmt(own.qty)}주</b> · 지금 가치 🪙 ${fmt(value)}<br>산 값 🪙 ${fmt(own.cost)} · <span class="${gain >= 0 ? "up" : "down"}">${gain >= 0 ? "+" : "-"}🪙 ${fmt(Math.abs(gain))} (${own.cost ? ((gain / own.cost) * 100).toFixed(1) : 0}%)</span>`;
    } else {
      $("sMine").textContent = "아직 이 주식은 없어요.";
    }
    refreshTradeTotal(p);
    drawChart(k, tick);
    if (full) $("stockList").querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }

  function tradeQty() {
    return Math.max(0, Math.floor(+$("tradeQty").value || 0));
  }

  function refreshTradeTotal(price) {
    const n = tradeQty();
    const fee = Math.ceil(n * price * TRADE_FEE);
    $("tradeTotal").textContent = n ? `${fmt(n)}주 · 살 때 🪙 ${fmt(n * price + fee)} / 팔 때 🪙 ${fmt(n * price - fee)} 받음 (수수료 ${fmt(fee)})` : "";
  }

  function drawChart(k, tick) {
    const cv = $("stockChart");
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const n = 240; // points drawn, whatever the range
    const step = Math.max(1, Math.round(range / n));
    const pts = [];
    for (let i = n; i >= 0; i--) pts.push(stockPrice(k, tick - i * step));
    const lo = Math.min(...pts), hi = Math.max(...pts);
    const pad = 16;
    const x = (i) => pad + (i / n) * (w - pad * 2 - 56);
    const y = (p) => pad + (1 - (p - lo) / (hi - lo || 1)) * (h - pad * 2);
    const up = pts[pts.length - 1] >= pts[0];
    const color = up ? "#ff5a5a" : "#4c8dff";
    // grid + labels
    g.strokeStyle = "#ffffff12";
    g.fillStyle = "#9aa0b4";
    g.font = "12px Pretendard, sans-serif";
    g.textAlign = "left";
    for (let i = 0; i <= 4; i++) {
      const p = lo + ((hi - lo) * i) / 4;
      g.beginPath(); g.moveTo(pad, y(p)); g.lineTo(w - 56, y(p)); g.stroke();
      g.fillText(fmt(p), w - 50, y(p) + 4);
    }
    // area + line
    const grad = g.createLinearGradient(0, pad, 0, h);
    grad.addColorStop(0, up ? "#ff5a5a44" : "#4c8dff44");
    grad.addColorStop(1, "#00000000");
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(x(i), y(p)) : g.moveTo(x(i), y(p))));
    g.lineTo(x(n), h - pad); g.lineTo(x(0), h - pad); g.closePath();
    g.fillStyle = grad; g.fill();
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(x(i), y(p)) : g.moveTo(x(i), y(p))));
    g.strokeStyle = color; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.arc(x(n), y(pts[n]), 4, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  }

  function trade(kind) {
    const k = stockById(picked);
    const price = stockPrice(k, stockTick());
    const n = tradeQty();
    const r = kind === "buy" ? buyStock(save, picked, n, price) : sellStock(save, picked, n, price);
    const msg = $("tradeMsg");
    if (r.error) { msg.className = "hint warn"; msg.textContent = r.error; return; }
    save.coins = r.coins;
    save.stocks = r.stocks;
    persist();
    refreshWallet();
    msg.className = "hint";
    msg.textContent = kind === "buy" ? `${k.name} ${fmt(n)}주를 🪙 ${fmt(r.paid)}에 샀어요.` : `${k.name} ${fmt(n)}주를 팔아서 🪙 ${fmt(r.got)}을 받았어요.`;
    beep(kind === "buy" ? 660 : 520, 0.12, "triangle");
    renderStocks();
  }

  // ---------- Bank ----------
  function catchUpDebt() {
    const r = accrueDebt(save);
    if (r.debt !== save.debt || r.debtAt !== save.debtAt) {
      const grew = r.debt !== save.debt;
      save.debt = r.debt;
      save.debtAt = r.debtAt;
      if (grew) { persist(); refreshWallet(); }
    }
  }

  function renderBank() {
    catchUpDebt();
    const tiles = assetTiles(stockTick());
    const left = LOAN_LIMIT - save.debt;
    const next = save.debt ? Math.max(0, save.debtAt + LOAN_PERIOD_MS - Date.now()) : 0;
    const mm = Math.floor(next / 60000), ss = Math.floor((next % 60000) / 1000);
    tiles.splice(3, 0,
      el("div", { className: "asset" }, el("small", { textContent: "더 빌릴 수 있는 돈" }), el("b", { textContent: `🪙 ${fmt(left)}` })),
      el("div", { className: "asset" }, el("small", { textContent: "다음 이자까지" }), el("b", { textContent: save.debt ? `${mm}분 ${String(ss).padStart(2, "0")}초` : "-" })));
    $("bankGrid").replaceChildren(...tiles);
    document.querySelectorAll("[data-borrow]").forEach((b) => (b.disabled = left <= 0));
    document.querySelectorAll("[data-repay]").forEach((b) => (b.disabled = !save.debt || save.coins <= 0));
    $("bankruptBox").classList.toggle("hidden", !canGoBankrupt(save));
  }

  function bank(kind, how) {
    catchUpDebt();
    const wasFree = !save.debt;
    let r;
    if (kind === "borrow") r = borrow(save, how === "max" ? LOAN_LIMIT - save.debt : +how);
    else r = repay(save, how === "all" ? Math.min(save.debt, save.coins) : Math.min(+how, save.debt));
    const msg = $("bankMsg");
    if (r.error) { msg.className = "hint warn"; msg.textContent = r.error; return; }
    const diff = r.coins - save.coins;
    save.coins = r.coins;
    save.debt = r.debt;
    if (wasFree && save.debt) save.debtAt = Date.now(); // interest counts from the moment you start owing
    persist();
    refreshWallet();
    msg.className = "hint";
    msg.textContent = kind === "borrow" ? `🪙 ${fmt(diff)}을 빌렸어요.` : save.debt ? `🪙 ${fmt(-diff)}을 갚았어요.` : "빚을 다 갚았어요! 🎉";
    renderBank();
  }

  function goBankrupt() {
    if (!canGoBankrupt(save)) return;
    save.coins = 500;
    save.debt = 0;
    save.stocks = {};
    save.bankrupt = (save.bankrupt || 0) + 1;
    persist();
    refreshWallet();
    $("bankMsg").className = "hint";
    $("bankMsg").textContent = `파산 신청이 끝났어요. 🪙 500으로 다시 시작해요. (파산 ${save.bankrupt}번째)`;
    renderBank();
  }

  // ---------- Wiring ----------
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  $("closeShop").addEventListener("click", () => { view = "game"; refreshNav(); });
  $("solo").addEventListener("click", () => { view = "game"; refreshNav(); });
  $("stockSearch").addEventListener("input", () => renderStocks());
  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("active", x === b));
    renderStocks();
  }));
  document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    range = +b.dataset.range;
    document.querySelectorAll("[data-range]").forEach((x) => x.classList.toggle("active", x === b));
    renderStocks();
  }));
  document.querySelectorAll("[data-qty]").forEach((b) => b.addEventListener("click", () => {
    const price = stockPrice(stockById(picked), stockTick());
    $("tradeQty").value = b.dataset.qty === "max" ? Math.max(1, maxBuy(save.coins, price)) : tradeQty() + +b.dataset.qty;
    refreshTradeTotal(price);
  }));
  $("tradeQty").addEventListener("input", () => refreshTradeTotal(stockPrice(stockById(picked), stockTick())));
  $("buyBtn").addEventListener("click", () => trade("buy"));
  $("sellBtn").addEventListener("click", () => trade("sell"));
  document.querySelectorAll("[data-borrow]").forEach((b) => b.addEventListener("click", () => bank("borrow", b.dataset.borrow)));
  document.querySelectorAll("[data-repay]").forEach((b) => b.addEventListener("click", () => bank("repay", b.dataset.repay)));
  $("bankrupt").addEventListener("click", goBankrupt);
  window.addEventListener("resize", () => { if (view === "stocks") renderStocks(); });

  setInterval(() => {
    catchUpDebt();
    refreshNav();
    if (view === "stocks" && stockTick() !== lastTick) renderStocks();
    if (view === "bank") renderBank();
  }, 1000);
  refreshNav();
})();
