(() => {
  const L = window.Logic;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const RING = 263.9;

  let TODAY = L.ymd(new Date());
  let selDay = TODAY;
  let selMonth = TODAY.slice(0, 7);
  let view = "today";
  let data = null;
  let earnedBefore = null;

  function save() {
    window.api.save(data);
    render();
  }

  function setRing(fg, text, ratio) {
    fg.setAttribute("stroke-dashoffset", (RING * (1 - (ratio || 0))).toFixed(1));
    text.textContent = ratio == null ? "–" : Math.round(ratio * 100) + "%";
  }

  const pct = (r) => (r == null ? "–" : Math.round(r * 100) + "%");

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  // ---------- today ----------
  function renderToday() {
    const s = L.dayStats(data, selDay);
    $("dayTitle").textContent = selDay === TODAY ? "오늘의 숙제" : L.fmtDay(selDay) + " 숙제";
    setRing($("ringFg"), $("ringText"), s.ratio);
    $("hwCount").textContent = `${s.done} / ${s.total} 완료`;
    const left = s.total - s.done;
    $("hwHint").textContent = !s.total ? "아직 등록한 숙제가 없어요." : left === 0 ? "다 끝냈어요! 수고했어요." : `남은 숙제 ${left}개`;

    const empty = data.homework.length === 0 && data.goals.length === 0;
    $("hwList").innerHTML = s.items.length
      ? s.items.map((h) => `
        <li class="hw${h.done ? " done" : ""}" data-id="${h.id}">
          <input type="checkbox" id="hw-${h.id}" ${h.done ? "checked" : ""}>
          ${h.subject ? `<span class="chip">${esc(h.subject)}</span>` : "<span></span>"}
          <label class="title" for="hw-${h.id}">${esc(h.title)}</label>
          <button class="icon-btn" type="button" data-del aria-label="삭제">✕</button>
        </li>`).join("")
      : `<li class="empty">위 칸에 숙제를 적고 ‘추가’를 눌러 보세요.${empty ? ` <button class="btn small" type="button" id="loadSample">예시로 채워 보기</button>` : ""}</li>`;

    const subjects = [...new Set(data.homework.map((h) => h.subject).filter(Boolean))];
    $("subjectList").innerHTML = subjects.map((s) => `<option value="${esc(s)}"></option>`).join("");

    const m = L.monthSummary(data, TODAY.slice(0, 7));
    setRing($("mRingFg"), $("mRingText"), m.goalRate);
    $("mGoalsLine").textContent = m.goals.length ? `목표 ${m.goals.length}개 중 ${m.goalsDone}개 달성` : "아직 목표가 없어요";
    $("mHwLine").textContent = m.hwTotal ? `이번 달 숙제 ${m.hwDone}/${m.hwTotal}개 완료` : "";
    $("miniGoals").innerHTML = m.goals.slice(0, 4).map((g) => {
      const r = L.goalRatio(g);
      return `<div style="display:grid;gap:4px;margin-bottom:8px">
        <div class="goal-meta"><span style="color:var(--fg)">${esc(g.title)}</span><span class="num">${L.goalProgress(g)}/${g.target}${esc(g.unit || "")}</span></div>
        <div class="bar${r >= 1 ? " good" : ""}"><span style="width:${r * 100}%"></span></div>
      </div>`;
    }).join("");
  }

  // ---------- goals ----------
  function renderGoals() {
    const [y, m] = selMonth.split("-").map(Number);
    $("monthTitle").textContent = selMonth === TODAY.slice(0, 7) ? "이번 달 목표" : `${m}월 목표`;
    const sum = L.monthSummary(data, selMonth);
    $("goalRate").textContent = pct(sum.goalRate);
    $("goalDone").textContent = `${sum.goalsDone}/${sum.goals.length}`;
    $("hwMonthRate").textContent = sum.hwTotal ? pct(sum.hwDone / sum.hwTotal) : "–";

    const days = L.daysInMonth(selMonth);
    let perfect = 0;
    for (let d = 1; d <= days; d++) {
      const s = L.dayStats(data, `${selMonth}-${L.pad(d)}`);
      if (s.total && s.done === s.total) perfect++;
    }
    $("perfectDays").textContent = perfect + "일";

    $("goalList").innerHTML = sum.goals.length
      ? sum.goals.map((g) => {
          const r = L.goalRatio(g);
          const st = L.goalStatus(g, TODAY);
          const p = L.goalProgress(g);
          let ctrl, extra = "";
          if (g.type === "daily") {
            const checks = new Set(g.checks || []);
            const checkedToday = checks.has(TODAY);
            ctrl = selMonth === TODAY.slice(0, 7)
              ? `<button class="btn small${checkedToday ? " on" : ""}" type="button" data-check="${TODAY}">${checkedToday ? "오늘 완료 ✓" : "오늘 체크"}</button>`
              : "";
            let dots = "";
            for (let d = 1; d <= days; d++) {
              const key = `${selMonth}-${L.pad(d)}`;
              dots += `<button type="button" data-check="${key}" class="${checks.has(key) ? "on" : ""}${key === TODAY ? " today" : ""}" ${key > TODAY ? "disabled" : ""} aria-label="${m}월 ${d}일 ${checks.has(key) ? "완료" : "미완료"}" title="${m}월 ${d}일"></button>`;
            }
            extra = `<div class="dots">${dots}</div>`;
          } else {
            ctrl = `<button class="btn small" type="button" data-step="-1" aria-label="하나 빼기">−</button>
                    <button class="btn small" type="button" data-step="1">+1</button>`;
          }
          return `<div class="goal" data-id="${g.id}">
            <div class="goal-top">
              <span class="goal-name">${esc(g.title)} <span class="label">${g.type === "daily" ? "매일 체크" : "횟수"}</span></span>
              <span class="goal-ctrl">${ctrl}<button class="icon-btn" type="button" data-del aria-label="목표 삭제">✕</button></span>
            </div>
            <div class="bar${r >= 1 ? " good" : ""}"><span style="width:${r * 100}%"></span></div>
            ${extra}
            <div class="goal-meta"><span class="num">${p} / ${g.target}${esc(g.unit || "")} · ${Math.round(r * 100)}%</span><span class="pill ${st.cls}">${st.text}</span></div>
          </div>`;
        }).join("")
      : `<p class="empty">이번 달에 이루고 싶은 목표와 목표 수를 적어 보세요.</p>`;

    const first = new Date(y, m - 1, 1).getDay();
    let html = L.DOW.map((d) => `<span class="dow">${d}</span>`).join("");
    for (let i = 0; i < first; i++) html += "<span></span>";
    for (let d = 1; d <= days; d++) {
      const key = `${selMonth}-${L.pad(d)}`;
      const s = L.dayStats(data, key);
      const lvl = s.ratio == null || s.ratio === 0 ? "" : s.ratio === 1 ? "l3" : s.ratio >= 0.5 ? "l2" : "l1";
      html += `<button type="button" data-day="${key}" class="${lvl}${key === TODAY ? " today" : ""}" title="${s.total ? `숙제 ${s.total}개 중 ${s.done}개 완료` : "숙제 없음"}">${d}</button>`;
    }
    $("cal").innerHTML = html;
  }

  // ---------- stats ----------
  function renderStats() {
    const subs = L.subjectStats(data, selMonth);
    $("subjList").innerHTML = subs.length
      ? subs.map((s) => {
          const r = s.done / s.total;
          return `<div class="subj"><span class="name">${esc(s.subject)}</span>
            <div class="bar${r === 1 ? " good" : ""}"><span style="width:${r * 100}%"></span></div>
            <span class="val num">${s.done}/${s.total} · ${Math.round(r * 100)}%</span></div>`;
        }).join("")
      : `<p class="empty">이 달에 등록한 숙제가 없어요.</p>`;

    if (subs.length) {
      const withLeft = subs.map((s) => ({ ...s, left: s.total - s.done, r: s.done / s.total }));
      const worst = [...withLeft].sort((a, b) => b.left - a.left || a.r - b.r)[0];
      const best = [...withLeft].filter((s) => s.total >= 2).sort((a, b) => b.r - a.r)[0];
      const lines = [];
      if (best) lines.push(`<strong style="color:var(--good)">${esc(best.subject)}</strong> 숙제를 가장 잘 끝내고 있어요 (${Math.round(best.r * 100)}%).`);
      if (worst && worst.left > 0) lines.push(`<strong style="color:var(--warn)">${esc(worst.subject)}</strong> 숙제가 ${worst.left}개 밀려 있어요. 오늘 하나씩 해 볼까요?`);
      else lines.push("밀린 숙제가 하나도 없어요!");
      $("subjInsight").innerHTML = lines.join("<br>");
    } else $("subjInsight").textContent = "숙제를 등록하면 과목별로 얼마나 끝냈는지 보여 드려요.";

    // last 14 days ending today
    const W = 700, H = 180, pl = 28, pb = 22, pt = 10;
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(L.addDays(TODAY, -i));
    const vals = days.map((d) => L.dayStats(data, d).done);
    const max = Math.max(4, ...vals);
    const step = Math.ceil(max / 4);
    const top = step * 4;
    const cw = (W - pl) / days.length;
    const y = (v) => pt + (H - pt - pb) * (1 - v / top);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 14일 완료한 숙제 수">`;
    for (let t = 0; t <= top; t += step) svg += `<line class="gridline" x1="${pl}" x2="${W}" y1="${y(t)}" y2="${y(t)}"></line><text x="${pl - 6}" y="${y(t) + 3}" text-anchor="end">${t}</text>`;
    days.forEach((d, i) => {
      const v = vals[i];
      const x = pl + i * cw + cw * 0.2;
      const h = Math.max(2, y(0) - y(v));
      svg += `<rect class="col${v === 0 ? " zero" : ""}${d === TODAY ? " today" : ""}" x="${x}" y="${y(0) - h}" width="${cw * 0.6}" height="${h}" rx="3"><title>${L.fmtDay(d)}: ${v}개</title></rect>`;
      svg += `<text x="${x + cw * 0.3}" y="${H - 6}" text-anchor="middle">${Number(d.slice(8))}</text>`;
    });
    $("chart14").innerHTML = svg + "</svg>";
  }

  // ---------- badges ----------
  function renderBadges() {
    const list = L.badges(data, TODAY);
    const st = L.streaks(data, TODAY);
    $("badgeCount").textContent = `${list.filter((b) => b.earned).length} / ${list.length}개 획득`;
    $("bStreak").textContent = st.current + "일";
    $("bBest").textContent = st.best + "일";
    $("bPerfect").textContent = st.perfectDays + "일";
    $("bHwDone").textContent = data.homework.filter((h) => h.done).length + "개";
    $("badgeGrid").innerHTML = list.map((b) => `
      <div class="badge ${b.earned ? "earned" : "locked"}">
        <span class="ico" aria-hidden="true">${b.icon}</span>
        <strong>${esc(b.name)}</strong>
        <small>${b.earned ? esc(b.desc) : "잠김 · " + esc(b.desc)}</small>
      </div>`).join("");
  }

  function checkNewBadges() {
    const earned = new Set(L.badges(data, TODAY).filter((b) => b.earned).map((b) => b.id));
    if (earnedBefore) {
      const fresh = L.badges(data, TODAY).filter((b) => b.earned && !earnedBefore.has(b.id));
      if (fresh.length) toast(`${fresh[0].icon} 새 배지: ${fresh[0].name}!`);
    }
    earnedBefore = earned;
  }

  // ---------- shell ----------
  function render() {
    const now = L.ymd(new Date());
    if (now !== TODAY) TODAY = now;
    const [y, m] = selMonth.split("-").map(Number);
    document.querySelectorAll("[data-month-label]").forEach((el) => (el.textContent = `${y}년 ${m}월`));
    document.documentElement.dataset.theme = data.settings.theme;
    $("themeToggle").textContent = data.settings.theme === "dark" ? "밝은 화면으로" : "어두운 화면으로";
    $("widgetToggle").textContent = data.settings.widgetOpen ? "위젯 닫기" : "위젯 열기";
    $("todayLabel").textContent = L.fmtDay(TODAY);
    const st = L.streaks(data, TODAY);
    $("sideStreak").textContent = st.current;
    $("sideBest").textContent = `최고 기록 ${st.best}일`;

    document.querySelectorAll(".nav button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    ({ today: renderToday, goals: renderGoals, stats: renderStats, badges: renderBadges })[view]();
    checkNewBadges();
  }

  function go(v) {
    view = v;
    render();
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-view]");
    if (nav) return go(nav.dataset.view);
    const ms = e.target.closest("[data-month-step]");
    if (ms) { selMonth = L.addMonths(selMonth, Number(ms.dataset.monthStep)); return render(); }
    if (e.target.id === "loadSample") {
      const s = L.sampleData(TODAY);
      data.homework = s.homework;
      data.goals = s.goals;
      earnedBefore = null; // don't toast every badge the sample unlocks
      save();
    }
  });

  $("hwForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("hwInput").value.trim();
    if (!title) return;
    data.homework.push({ id: L.uid(), date: selDay, subject: $("hwSubject").value.trim(), title, done: false });
    $("hwInput").value = "";
    $("hwInput").focus();
    save();
  });
  $("hwList").addEventListener("change", (e) => {
    const li = e.target.closest("li[data-id]");
    const h = li && data.homework.find((x) => x.id === li.dataset.id);
    if (!h) return;
    h.done = e.target.checked;
    if (h.done) {
      const s = L.dayStats(data, selDay);
      if (s.total && s.done === s.total) toast("오늘 숙제를 모두 끝냈어요! 🎉");
    }
    save();
  });
  $("hwList").addEventListener("click", (e) => {
    if (!e.target.closest("[data-del]")) return;
    const id = e.target.closest("li").dataset.id;
    data.homework = data.homework.filter((x) => x.id !== id);
    save();
  });

  $("prevDay").onclick = () => { selDay = L.addDays(selDay, -1); selMonth = selDay.slice(0, 7); render(); };
  $("nextDay").onclick = () => { selDay = L.addDays(selDay, 1); selMonth = selDay.slice(0, 7); render(); };
  $("goToday").onclick = () => { selDay = TODAY; selMonth = TODAY.slice(0, 7); render(); };

  $("goalType").addEventListener("change", () => {
    const daily = $("goalType").value === "daily";
    $("goalTypeHelp").textContent = daily
      ? "매일 체크: 한 날에 한 번씩 체크해서 목표 일수를 채워요."
      : "횟수 세기: +1 버튼으로 할 때마다 올려요.";
    if (daily) { $("goalUnit").value = "일"; $("goalTarget").value = Math.min(20, L.daysInMonth(selMonth)); }
  });
  $("goalForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("goalInput").value.trim();
    if (!title) return;
    const type = $("goalType").value;
    let target = Math.max(1, Math.min(9999, parseInt($("goalTarget").value, 10) || 1));
    if (type === "daily") target = Math.min(target, L.daysInMonth(selMonth));
    const g = { id: L.uid(), month: selMonth, type, title, target, unit: $("goalUnit").value.trim() };
    if (type === "daily") g.checks = []; else g.progress = 0;
    data.goals.push(g);
    $("goalInput").value = "";
    save();
  });
  $("goalList").addEventListener("click", (e) => {
    const row = e.target.closest(".goal");
    const g = row && data.goals.find((x) => x.id === row.dataset.id);
    if (!g) return;
    const before = L.goalProgress(g) >= g.target;
    const step = e.target.closest("[data-step]");
    const check = e.target.closest("[data-check]");
    if (step) g.progress = Math.max(0, (g.progress || 0) + Number(step.dataset.step));
    else if (check) {
      const set = new Set(g.checks || []);
      set.has(check.dataset.check) ? set.delete(check.dataset.check) : set.add(check.dataset.check);
      g.checks = [...set].sort();
    } else if (e.target.closest("[data-del]")) data.goals = data.goals.filter((x) => x !== g);
    else return;
    if (!before && L.goalProgress(g) >= g.target) toast(`🎯 '${g.title}' 목표 달성!`);
    save();
  });
  $("cal").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    selDay = b.dataset.day;
    go("today");
  });

  $("themeToggle").onclick = () => { data.settings.theme = data.settings.theme === "dark" ? "light" : "dark"; save(); };
  $("widgetToggle").onclick = () => { data.settings.widgetOpen = !data.settings.widgetOpen; save(); };

  window.api.onChange((next) => { data = next; render(); });
  window.api.load().then((d) => { data = d; render(); });
  // Roll over to the new day if the app stays open past midnight.
  setInterval(() => { if (data && L.ymd(new Date()) !== TODAY) { selDay = L.ymd(new Date()); selMonth = selDay.slice(0, 7); render(); } }, 60000);
})();
