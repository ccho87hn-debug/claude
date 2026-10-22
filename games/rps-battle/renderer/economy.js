// The side menu and the money outside the arena: working for coins and the bank.
// Uses the wallet (`save`, `persist`, `refreshWallet`) and round state from game.js.
(function () {
  const { RANKS, rankOf, nextLetter, LOAN_LIMIT, LOAN_PERIOD_MS, accrueDebt, borrow, repay, canGoBankrupt } = window.RPS;
  const fmt = (n) => Math.round(n).toLocaleString();
  const MISS_PAUSE_MS = 500;

  let view = "game";
  let letter = nextLetter("");
  let pausedUntil = 0;
  let session = { hits: 0, misses: 0, earned: 0 };

  // ---------- Menu ----------
  function inRound() {
    return phase === "countdown" || phase === "betting" || phase === "running" || phase === "done";
  }

  function showView(v) {
    if (v !== "game" && room) return; // the room keeps you in the game; leave it first
    if (v !== "game" && inRound()) quitRound(); // walking away from a solo round
    view = v;
    $("layout").classList.toggle("alt-view", v === "work" || v === "bank");
    $("workView").classList.toggle("hidden", v !== "work");
    $("bankView").classList.toggle("hidden", v !== "bank");
    if (v === "shop") openShop();
    else if (v === "game" && !room && !inRound()) showLobby();
    if (v !== "work" && v !== "bank") resize(); // the arena may have been hidden while the window changed size
    if (v === "work") { renderWork(); $("keyBox").focus(); }
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

  // ---------- Work ----------
  function renderWork() {
    const done = save.workDone || 0;
    const r = rankOf(done);
    const rank = RANKS[r], next = RANKS[r + 1];
    $("wRank").textContent = rank.name;
    $("wPay").textContent = `🪙 ${fmt(rank.pay)}`;
    $("wBar").style.width = next ? `${((done - rank.need) / (next.need - rank.need)) * 100}%` : "100%";
    $("wNext").textContent = next ? `${next.name}까지 ${fmt(next.need - done)}번 더 맞히면 승진 (지금까지 ${fmt(done)}번)` : `최고 직급이에요! (지금까지 ${fmt(done)}번)`;
    $("keyCap").textContent = letter;
    const tile = (label, value) => el("div", { className: "asset" }, el("small", { textContent: label }), el("b", { textContent: value }));
    $("wStats").replaceChildren(tile("이번에 번 돈", `🪙 ${fmt(session.earned)}`), tile("맞힘", fmt(session.hits)), tile("틀림", fmt(session.misses)));
    $("rankList").replaceChildren(...RANKS.map((k, i) => el("div", { className: "rank-row" + (i === r ? " now" : i < r ? " done" : "") },
      el("b", { textContent: k.name }), el("span", { textContent: `${fmt(k.need)}번` }), el("span", { textContent: `🪙 ${k.pay}` }))));
  }

  // "사원으로", "부장으로", "이사로": picks 로/으로 by the last syllable.
  function withRo(word) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    const tail = code >= 0 && code < 11172 ? code % 28 : 0;
    return word + (tail === 0 || tail === 8 ? "로" : "으로");
  }

  function flashKey(cls) {
    const cap = $("keyCap");
    cap.classList.remove("hit", "miss");
    void cap.offsetWidth; // restart the animation
    cap.classList.add(cls);
    setTimeout(() => cap.classList.remove(cls), cls === "hit" ? 90 : 320);
  }

  function popText(text) {
    const box = $("keyBox");
    const p = el("div", { className: "pop", textContent: text });
    p.style.left = 40 + Math.random() * (box.clientWidth - 120) + "px";
    p.style.top = 60 + Math.random() * 80 + "px";
    box.append(p);
    setTimeout(() => p.remove(), 700);
  }

  // Saving after every key press would hammer the account, so work is saved a moment later in one go.
  let savePending = false;
  setInterval(() => { if (savePending) { savePending = false; persist(); } }, 2000);

  function onWorkKey(e) {
    if (view !== "work" || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!/^[a-zA-Z]$/.test(e.key)) return;
    e.preventDefault();
    if (e.repeat || performance.now() < pausedUntil) return; // holding a key down doesn't count
    if (e.key.toUpperCase() !== letter) {
      session.misses++;
      pausedUntil = performance.now() + MISS_PAUSE_MS;
      $("keyHint").textContent = `틀렸어요! ${letter} 키를 눌러야 해요`;
      flashKey("miss");
      beep(200, 0.15, "sawtooth");
      renderWork();
      return;
    }
    const before = rankOf(save.workDone || 0);
    const pay = RANKS[before].pay;
    save.workDone = (save.workDone || 0) + 1;
    save.coins += pay;
    session.hits++;
    session.earned += pay;
    letter = nextLetter(letter);
    $("keyHint").textContent = "화면에 나온 알파벳 키를 키보드에서 눌러요";
    flashKey("hit");
    popText(`+🪙 ${pay}`);
    beep(700 + Math.random() * 200, 0.05, "square");
    const after = rankOf(save.workDone);
    if (after > before) {
      const f = el("div", { className: "promo-flash", textContent: `🎉 ${withRo(RANKS[after].name)} 승진!` });
      $("keyBox").append(f);
      setTimeout(() => f.remove(), 1600);
      beep(990, 0.3, "triangle");
    }
    savePending = true;
    refreshWallet();
    renderWork();
  }

  function assetTiles() {
    const tile = (label, value, cls = "") => el("div", { className: "asset " + cls }, el("small", { textContent: label }), el("b", { textContent: value }));
    return [
      tile("코인", `🪙 ${fmt(save.coins)}`),
      tile("빚", save.debt ? `-🪙 ${fmt(save.debt)}` : "없음", save.debt ? "down" : ""),
    ];
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
    const tiles = assetTiles();
    const left = LOAN_LIMIT - save.debt;
    const next = save.debt ? Math.max(0, save.debtAt + LOAN_PERIOD_MS - Date.now()) : 0;
    const mm = Math.floor(next / 60000), ss = Math.floor((next % 60000) / 1000);
    tiles.push(
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
  document.addEventListener("keydown", onWorkKey);
  document.querySelectorAll("[data-borrow]").forEach((b) => b.addEventListener("click", () => bank("borrow", b.dataset.borrow)));
  document.querySelectorAll("[data-repay]").forEach((b) => b.addEventListener("click", () => bank("repay", b.dataset.repay)));
  $("bankrupt").addEventListener("click", goBankrupt);

  setInterval(() => {
    catchUpDebt();
    refreshNav();
    if (view === "bank") renderBank();
  }, 1000);
  refreshNav();
})();
