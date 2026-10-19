(() => {
  const L = window.Logic;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const RING = 263.9;

  let TODAY = L.ymd(new Date());
  let selDay = TODAY;
  let selMonth = TODAY.slice(0, 7);
  let selWeek = L.weekStart(TODAY);
  let view = "today";
  let editing = null; // id of the homework, goal or caution being edited inline
  let planWeek = L.weekStart(TODAY);
  let planSel = { r: "0", c: 1 }; // selected spreadsheet cell
  let pendingRow = false; // a new, still unnamed subject row
  let memoMode = null; // "edit" | "view"; null = pick based on whether the memo has text
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
  const shortDay = (s) => { const d = L.parse(s); return `${d.getMonth() + 1}/${d.getDate()}(${L.DOW[d.getDay()]})`; };

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  function noteBadge(n) {
    const diff = L.dayDiff(TODAY, n.date);
    const cls = diff < 0 ? "past" : diff <= 2 ? "soon" : "";
    return `<span class="dd ${cls}">${L.dday(n.date, TODAY)}</span>`;
  }

  // ---------- today ----------
  function hwRow(h) {
    if (editing === h.id) {
      return `<li class="edit-row" data-id="${h.id}">
        <input class="narrow" data-f="subject" value="${esc(h.subject || "")}" placeholder="과목" maxlength="12" list="subjectList" aria-label="과목">
        <input class="grow" data-f="title" value="${esc(h.title)}" maxlength="80" aria-label="숙제 내용">
        <input type="date" data-f="date" value="${h.date}" aria-label="날짜">
        <button class="btn small primary" type="button" data-save>저장</button>
        <button class="btn small" type="button" data-cancel>취소</button>
      </li>`;
    }
    return `<li class="hw${h.done ? " done" : ""}" data-id="${h.id}">
      <input type="checkbox" id="hw-${h.id}" ${h.done ? "checked" : ""}>
      ${h.subject ? `<span class="chip">${esc(h.subject)}</span>` : "<span></span>"}
      <label class="title" for="hw-${h.id}">${esc(h.title)}</label>
      <span class="row-ctrl">
        <button class="icon-btn" type="button" data-edit aria-label="고치기" title="고치기">✎</button>
        <button class="icon-btn del" type="button" data-del aria-label="삭제" title="삭제">✕</button>
      </span>
    </li>`;
  }

  function renderToday() {
    const s = L.dayStats(data, selDay);
    $("dayTitle").textContent = selDay === TODAY ? "오늘의 숙제" : L.fmtDay(selDay) + " 숙제";
    setRing($("ringFg"), $("ringText"), s.ratio);
    $("hwCount").textContent = `${s.done} / ${s.total} 완료`;
    $("hwCountSmall").textContent = s.total ? `${s.total}개` : "";
    const left = s.total - s.done;
    $("hwHint").textContent = !s.total ? "아직 등록한 숙제가 없어요." : left === 0 ? "다 끝냈어요! 수고했어요." : `남은 숙제 ${left}개`;

    const empty = !data.homework.length && !data.goals.length && !data.notes.length;
    $("hwList").innerHTML = s.items.length
      ? s.items.map(hwRow).join("")
      : `<li class="empty">위 칸에 숙제를 적고 ‘추가’를 눌러 보세요.${empty ? ` <button class="btn small" type="button" id="loadSample">예시로 채워 보기</button>` : ""}</li>`;

    const subjects = [...new Set(data.homework.map((h) => h.subject).filter(Boolean))];
    $("subjectList").innerHTML = subjects.map((s) => `<option value="${esc(s)}"></option>`).join("");

    const md = data.settings.manageDay;
    const nextWs = L.addDays(L.weekStart(TODAY), 7);
    $("manageBanner").hidden = !L.isManageDay(TODAY, md);
    $("manageText").textContent = `다음 주(${shortDay(nextWs)} ~ ${shortDay(L.addDays(nextWs, 6))}) 숙제와 할 일을 계획표에 미리 적어 보세요.`
      + (data.planLog[nextWs] ? " ✓ 이미 계획했어요." : "");

    const up = L.upcomingNotes(data, TODAY, 7);
    $("todayAlert").hidden = !up.length;
    $("todayAlertList").innerHTML = up.map((n) => `
      <div class="alert-item">${noteBadge(n)}
        <span class="kind ${n.kind}" style="padding:0 6px">${L.NOTE_KINDS[n.kind]}</span>
        <span>${esc(n.text)}</span><span class="label">${shortDay(n.date)}</span></div>`).join("");

    const m = L.monthSummary(data, TODAY.slice(0, 7));
    setRing($("mRingFg"), $("mRingText"), m.goalRate);
    $("mGoalsLine").textContent = m.goals.length ? `목표 ${m.goals.length}개 중 ${m.goalsDone}개 달성` : "아직 목표가 없어요";
    $("mHwLine").textContent = m.hwTotal ? `이번 달 숙제 ${m.hwDone}/${m.hwTotal}개 완료` : "";
    $("miniGoals").innerHTML = m.goals.slice(0, 5).map((g) => {
      const r = L.goalRatio(g);
      return `<div style="display:grid;gap:4px">
        <div class="goal-meta"><span style="color:var(--fg)">${esc(g.title)}</span><span class="num">${L.goalProgress(g)}/${g.target}${esc(g.unit || "")}</span></div>
        <div class="bar${r >= 1 ? " good" : ""}"><span style="width:${r * 100}%"></span></div>
      </div>`;
    }).join("");
  }

  // ---------- week ----------
  function renderWeek() {
    const days = L.weekDays(selWeek);
    const isThis = selWeek === L.weekStart(TODAY);
    $("weekTitle").textContent = isThis ? "이번 주" : "주간 보기";
    $("weekRange").textContent = `${shortDay(days[0])} ~ ${shortDay(days[6])}`;

    $("weekBoard").innerHTML = days.map((d) => {
      const dt = L.parse(d);
      const s = L.dayStats(data, d);
      const notes = data.notes.filter((n) => n.date === d);
      const cls = ["wday", d === TODAY ? "today" : "", dt.getDay() === 0 || dt.getDay() === 6 ? "weekend" : ""].join(" ");
      const items = [
        ...notes.map((n) => `<div class="wday-item note" title="${L.NOTE_KINDS[n.kind]}"><b class="flame">⚠</b><span>${esc(n.text)}</span></div>`),
        ...s.items.map((h) => `<label class="wday-item${h.done ? " done" : ""}" data-id="${h.id}"><input type="checkbox" ${h.done ? "checked" : ""}><span>${h.subject ? esc(h.subject) + " · " : ""}${esc(h.title)}</span></label>`),
      ].join("");
      return `<div class="${cls}">
        <div class="wday-head"><strong>${L.DOW[dt.getDay()]}</strong><span class="label num">${dt.getMonth() + 1}/${dt.getDate()}</span></div>
        <div class="wday-body">${items || `<span class="label">비어 있음</span>`}</div>
        <div class="wday-foot">${s.total ? `${s.done}/${s.total} 완료` : "–"}</div>
        <button class="wday-add" type="button" data-addday="${d}">+ 숙제</button>
      </div>`;
    }).join("");

    // Cautions for this week plus anything later that's still open.
    if (!$("noteDate").value) $("noteDate").value = TODAY;
    const shown = data.notes
      .filter((n) => (n.date >= days[0] && n.date <= days[6]) || (!n.done && n.date > days[6]))
      .sort((a, b) => a.done - b.done || a.date.localeCompare(b.date));
    $("noteList").innerHTML = shown.length
      ? shown.map((n) => editing === n.id
        ? `<li class="edit-row" data-id="${n.id}">
            <input type="date" data-f="date" value="${n.date}" aria-label="날짜">
            <select data-f="kind" aria-label="종류">${Object.entries(L.NOTE_KINDS).map(([k, v]) => `<option value="${k}" ${k === n.kind ? "selected" : ""}>${v}</option>`).join("")}</select>
            <input class="grow" data-f="text" value="${esc(n.text)}" maxlength="60" aria-label="내용">
            <button class="btn small primary" type="button" data-save>저장</button>
            <button class="btn small" type="button" data-cancel>취소</button>
          </li>`
        : `<li class="note${n.done ? " done" : ""}" data-id="${n.id}">
            <input type="checkbox" ${n.done ? "checked" : ""} aria-label="확인함">
            ${noteBadge(n)}
            <span class="kind ${n.kind}">${L.NOTE_KINDS[n.kind]}</span>
            <span class="text">${esc(n.text)} <span class="label">${shortDay(n.date)}</span></span>
            <span class="row-ctrl">
              <button class="icon-btn" type="button" data-edit aria-label="고치기" title="고치기">✎</button>
              <button class="icon-btn del" type="button" data-del aria-label="삭제" title="삭제">✕</button>
            </span>
          </li>`).join("")
      : `<li class="empty">시험, 준비물, 마감일을 적어 두면 날짜가 다가올 때 오늘 화면과 위젯에 알려 드려요.</li>`;

    renderMemo();
  }

  function renderMemo() {
    const text = data.memos[selWeek] || "";
    const mode = memoMode || (text.trim() ? "view" : "edit");
    $("tabEdit").setAttribute("aria-selected", mode === "edit");
    $("tabView").setAttribute("aria-selected", mode === "view");
    $("memoEditWrap").hidden = mode !== "edit";
    $("memoView").hidden = mode !== "view";
    const ed = $("memoEditor");
    if (document.activeElement !== ed && ed.value !== text) ed.value = text;
    if (mode === "view") {
      const blocks = L.memoBlocks(text);
      $("memoView").innerHTML = blocks.length
        ? blocks.map((b) => ({
            heading: () => `<h3>${esc(b.text)}</h3>`,
            item: () => `<div class="m-item">${esc(b.text)}</div>`,
            important: () => `<div class="m-imp">! ${esc(b.text)}</div>`,
            task: () => `<div class="m-task${b.done ? " done" : ""}"><span class="box">${b.done ? "✓" : ""}</span><span>${esc(b.text)}</span></div>`,
            gap: () => `<div class="m-gap"></div>`,
            text: () => `<p>${esc(b.text)}</p>`,
          })[b.type]()).join("")
        : `<p class="empty">아직 메모가 없어요. ‘편집’을 눌러 이번 주 계획을 적어 보세요.</p>`;
    }
  }

  // ---------- spreadsheet planner ----------
  const COLS = "ABCDEFGHI";

  function nextManageDate() {
    for (let i = 0; i < 7; i++) {
      const d = L.addDays(TODAY, i);
      if (L.isManageDay(d, data.settings.manageDay)) return d;
    }
  }

  function renderPlan() {
    const days = L.weekDays(planWeek);
    const rows = L.plannerRows(data, planWeek);
    if (pendingRow) rows.push(null);
    const thisWs = L.weekStart(TODAY);
    $("planTitle").textContent = planWeek === thisWs ? "주간 계획표 · 이번 주" : planWeek === L.addDays(thisWs, 7) ? "주간 계획표 · 다음 주" : "주간 계획표";
    $("planRange").textContent = `${shortDay(days[0])} ~ ${shortDay(days[6])}`;
    $("manageDay").value = String(data.settings.manageDay);

    const nextWs = L.addDays(thisWs, 7);
    if (L.isManageDay(TODAY, data.settings.manageDay)) {
      $("manageStatus").innerHTML = `오늘은 관리의 날이에요. 다음 주 계획을 세워요. ${data.planLog[nextWs] ? `<span class="ok">✓ 다음 주 계획 완료</span>` : ""}`;
    } else {
      const nd = nextManageDate();
      $("manageStatus").textContent = `다음 관리의 날: ${shortDay(nd)} (${L.dday(nd, TODAY)})`;
    }

    const head1 = `<tr><th></th>${[...COLS].map((c) => `<th data-col="${COLS.indexOf(c)}">${c}</th>`).join("")}</tr>`;
    const head2 = `<tr class="days"><th class="rn"></th><th data-col="0">과목</th>${days.map((d, i) => {
      const dt = L.parse(d);
      const cls = [d === TODAY ? "today" : "", dt.getDay() === 0 || dt.getDay() === 6 ? "weekend" : ""].join(" ");
      return `<th class="${cls}" data-col="${i + 1}">${L.DOW[dt.getDay()]} <span class="num">${dt.getMonth() + 1}/${dt.getDate()}</span></th>`;
    }).join("")}<th data-col="8">합계</th></tr>`;

    const body = rows.map((name, r) => {
      const cells = days.map((d, i) => {
        if (name === null) return `<td><input class="xc" data-r="${r}" data-c="${i + 1}" disabled></td>`;
        const items = L.cellItems(data, d, name);
        const done = items.filter((h) => h.done).length;
        const cls = items.length && done === items.length ? "done" : done ? "part" : "";
        const tip = items.map((h) => (h.done ? "✓ " : "□ ") + h.title).join("\n");
        return `<td class="${cls}" title="${esc(tip)}"><input class="xc" data-r="${r}" data-c="${i + 1}" value="${esc(L.cellText(data, d, name))}"></td>`;
      }).join("");
      const tot = name === null ? "" : days.reduce((a, d) => a + L.cellItems(data, d, name).length, 0) || "";
      return `<tr><th class="rn" data-row="${r}">${r + 1}</th>
        <td><input class="xc subj" data-r="${r}" data-c="0" value="${esc(name || "")}" placeholder="${name === "" ? "(과목 없음)" : "과목 이름"}"></td>
        ${cells}<td class="tot">${tot}</td></tr>`;
    }).join("");

    const noteRow = `<tr class="note-row"><th class="rn" data-row="note">⚠</th><td><span class="subj-label">주의할 것</span></td>${days.map((d, i) =>
      `<td><input class="xc" data-r="note" data-c="${i + 1}" value="${esc(L.noteCellText(data, d))}" placeholder=""></td>`).join("")}
      <td class="tot">${data.notes.filter((n) => days.includes(n.date)).length || ""}</td></tr>`;

    const foot = `<tr><td></td><td class="lbl">완료 / 전체</td>${days.map((d) => {
      const s = L.dayStats(data, d);
      return `<td>${s.total ? `${s.done}/${s.total}` : "–"}</td>`;
    }).join("")}<td>${days.reduce((a, d) => a + L.dayStats(data, d).total, 0)}</td></tr>`;

    $("planGrid").innerHTML = `<colgroup><col class="c-rn"><col class="c-subj">${"<col>".repeat(7)}<col class="c-tot"></colgroup>
      <thead>${head1}${head2}</thead><tbody>${body}${noteRow}</tbody><tfoot>${foot}</tfoot>`;
    highlightSel();
  }

  const cellEl = (r, c) => $("planGrid").querySelector(`input.xc[data-r="${r}"][data-c="${c}"]`);
  const rowOrder = () => [...new Set([...$("planGrid").querySelectorAll("input.xc")].map((i) => i.dataset.r))];

  function highlightSel() {
    $("planGrid").querySelectorAll(".hl").forEach((el) => el.classList.remove("hl"));
    $("planGrid").querySelectorAll(`[data-col="${planSel.c}"]`).forEach((el) => el.classList.add("hl"));
    const rn = $("planGrid").querySelector(`[data-row="${planSel.r}"]`);
    if (rn) rn.classList.add("hl");
    const rowNo = planSel.r === "note" ? rowOrder().length : Number(planSel.r) + 1;
    $("nameBox").textContent = COLS[planSel.c] + rowNo;
    const el = cellEl(planSel.r, planSel.c);
    if (document.activeElement !== $("fxInput")) $("fxInput").value = el ? el.value : "";
  }

  function logPlan() {
    if (planWeek <= L.weekStart(TODAY)) return; // only planning ahead counts
    const prev = data.planLog[planWeek] || {};
    data.planLog[planWeek] = { at: TODAY, onManageDay: !!prev.onManageDay || L.isManageDay(TODAY, data.settings.manageDay) };
  }

  function commitCell(el) {
    const days = L.weekDays(planWeek);
    const rows = L.plannerRows(data, planWeek);
    const c = Number(el.dataset.c);
    const r = el.dataset.r;
    if (r === "note") {
      L.applyNoteCell(data, days[c - 1], el.value);
    } else if (c === 0) {
      const oldName = pendingRow && Number(r) === rows.length ? null : rows[Number(r)];
      const name = el.value.trim();
      const list = data.plannerSubjects;
      if (oldName === null) {
        pendingRow = false;
        if (name && !list.includes(name)) list.push(name);
      } else if (name !== oldName) {
        const i = list.indexOf(oldName);
        if (name) {
          if (i >= 0) list[i] = name; else if (!list.includes(name)) list.push(name);
          for (const h of data.homework) if (days.includes(h.date) && (h.subject || "") === oldName) h.subject = name;
        } else if (i >= 0) list.splice(i, 1);
      } else return;
    } else {
      L.applyCell(data, days[c - 1], rows[Number(r)], el.value);
      logPlan();
    }
    window.api.save(data);
    // Re-render after focus has moved on, then put focus back where the user is.
    setTimeout(() => {
      const inGrid = document.activeElement && document.activeElement.closest && document.activeElement.closest("#planGrid");
      renderPlan();
      renderChrome();
      checkNewBadges();
      if (inGrid) focusCell(planSel.r, planSel.c);
    }, 0);
  }

  function focusCell(r, c) {
    const el = cellEl(r, c);
    if (!el || el.disabled) return false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    return true;
  }

  // ---------- goals ----------
  function goalRow(g, days, m) {
    if (editing === g.id) {
      return `<div class="edit-row" data-id="${g.id}">
        <input class="grow" data-f="title" value="${esc(g.title)}" maxlength="40" aria-label="목표 이름">
        <input class="narrow" type="number" min="1" max="9999" data-f="target" value="${g.target}" aria-label="목표 수">
        <input class="narrow" data-f="unit" value="${esc(g.unit || "")}" maxlength="6" placeholder="단위" aria-label="단위">
        <button class="btn small primary" type="button" data-save>저장</button>
        <button class="btn small" type="button" data-cancel>취소</button>
      </div>`;
    }
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
        <span class="goal-ctrl">${ctrl}
          <button class="icon-btn" type="button" data-edit aria-label="고치기" title="고치기">✎</button>
          <button class="icon-btn del" type="button" data-del aria-label="목표 삭제" title="삭제">✕</button></span>
      </div>
      <div class="bar${r >= 1 ? " good" : ""}"><span style="width:${r * 100}%"></span></div>
      ${extra}
      <div class="goal-meta"><span class="num">${p} / ${g.target}${esc(g.unit || "")} · ${Math.round(r * 100)}%</span><span class="pill ${st.cls}">${st.text}</span></div>
    </div>`;
  }

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
      ? sum.goals.map((g) => goalRow(g, days, m)).join("")
      : `<p class="empty">이번 달에 이루고 싶은 목표와 목표 수를 적어 보세요.</p>`;

    const noteDays = new Set(data.notes.filter((n) => !n.done).map((n) => n.date));
    const first = new Date(y, m - 1, 1).getDay();
    let html = L.DOW.map((d) => `<span class="dow">${d}</span>`).join("");
    for (let i = 0; i < first; i++) html += "<span></span>";
    for (let d = 1; d <= days; d++) {
      const key = `${selMonth}-${L.pad(d)}`;
      const s = L.dayStats(data, key);
      const lvl = s.ratio == null || s.ratio === 0 ? "" : s.ratio === 1 ? "l3" : s.ratio >= 0.5 ? "l2" : "l1";
      html += `<button type="button" data-day="${key}" class="${lvl}${key === TODAY ? " today" : ""}${noteDays.has(key) ? " has-note" : ""}" title="${s.total ? `숙제 ${s.total}개 중 ${s.done}개 완료` : "숙제 없음"}">${d}</button>`;
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
      svg += `<rect class="col${v === 0 ? " zero" : ""}${d === TODAY ? " today" : ""}" x="${x}" y="${y(0) - h}" width="${cw * 0.6}" height="${h}"><title>${L.fmtDay(d)}: ${v}개</title></rect>`;
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
    const list = L.badges(data, TODAY);
    if (earnedBefore) {
      const fresh = list.filter((b) => b.earned && !earnedBefore.has(b.id));
      if (fresh.length) toast(`${fresh[0].icon} 새 배지: ${fresh[0].name}!`);
    }
    earnedBefore = new Set(list.filter((b) => b.earned).map((b) => b.id));
  }

  // ---------- shell ----------
  function renderChrome() {
    TODAY = L.ymd(new Date());
    const [y, m] = selMonth.split("-").map(Number);
    document.querySelectorAll("[data-month-label]").forEach((el) => (el.textContent = `${y}년 ${m}월`));
    document.documentElement.dataset.theme = data.settings.theme;
    $("themeToggleText").textContent = data.settings.theme === "dark" ? "밝은 화면으로" : "어두운 화면으로";
    $("widgetToggleText").textContent = data.settings.widgetOpen ? "위젯 닫기" : "위젯 열기";
    $("themeToggle").title = $("themeToggleText").textContent;
    $("widgetToggle").title = $("widgetToggleText").textContent;
    $("scaleVal").textContent = Math.round((data.settings.uiScale || 1) * 100) + "%";
    $("todayLabel").textContent = L.fmtDay(TODAY);
    const st = L.streaks(data, TODAY);
    $("sideStreak").textContent = st.current;
    $("sideBest").textContent = `최고 기록 ${st.best}일`;
    $("planDot").hidden = !L.isManageDay(TODAY, data.settings.manageDay);
  }

  function render() {
    renderChrome();

    document.querySelectorAll(".nav button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    ({ today: renderToday, week: renderWeek, plan: renderPlan, goals: renderGoals, stats: renderStats, badges: renderBadges })[view]();
    checkNewBadges();
  }

  function go(v) {
    if (v === "plan" && view !== "plan") planWeek = L.planWeekFor(TODAY, data.settings.manageDay);
    view = v;
    editing = null;
    render();
  }

  // Inline editor: read the inputs of the row being edited and apply them.
  function readEdit(row) {
    const out = {};
    row.querySelectorAll("[data-f]").forEach((el) => (out[el.dataset.f] = el.value.trim()));
    return out;
  }
  function applyEdit(row) {
    const id = row.dataset.id;
    const f = readEdit(row);
    const h = data.homework.find((x) => x.id === id);
    const g = data.goals.find((x) => x.id === id);
    const n = data.notes.find((x) => x.id === id);
    if (h) {
      if (!f.title) return;
      Object.assign(h, { title: f.title, subject: f.subject, date: f.date || h.date });
    } else if (g) {
      if (!f.title) return;
      let target = Math.max(1, Math.min(9999, parseInt(f.target, 10) || g.target));
      if (g.type === "daily") target = Math.min(target, L.daysInMonth(g.month));
      Object.assign(g, { title: f.title, target, unit: f.unit });
    } else if (n) {
      if (!f.text) return;
      Object.assign(n, { text: f.text, kind: f.kind, date: f.date || n.date });
    }
    editing = null;
    save();
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-view]");
    if (nav) return go(nav.dataset.view);
    const ms = e.target.closest("[data-month-step]");
    if (ms) { selMonth = L.addMonths(selMonth, Number(ms.dataset.monthStep)); return render(); }
    if (e.target.id === "loadSample") {
      const s = L.sampleData(TODAY);
      Object.assign(data, { homework: s.homework, goals: s.goals, notes: s.notes, memos: s.memos });
      earnedBefore = null; // don't toast every badge the sample unlocks
      return save();
    }
    if (e.target.closest("[data-edit]")) { editing = e.target.closest("[data-id]").dataset.id; render(); focusEdit(); return; }
    if (e.target.closest("[data-cancel]")) { editing = null; return render(); }
    if (e.target.closest("[data-save]")) return applyEdit(e.target.closest("[data-id]"));
  });
  document.addEventListener("keydown", (e) => {
    const row = e.target.closest && e.target.closest(".edit-row");
    if (!row) return;
    if (e.key === "Enter") { e.preventDefault(); applyEdit(row); }
    if (e.key === "Escape") { editing = null; render(); }
  });
  function focusEdit() {
    const el = document.querySelector('.edit-row [data-f="title"], .edit-row [data-f="text"]');
    if (el) { el.focus(); el.select(); }
  }

  $("hwForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("hwInput").value.trim();
    if (!title) return;
    data.homework.push({ id: L.uid(), date: selDay, subject: $("hwSubject").value.trim(), title, done: false });
    $("hwInput").value = "";
    $("hwInput").focus();
    save();
  });
  function toggleHomework(id, done, day) {
    const h = data.homework.find((x) => x.id === id);
    if (!h) return;
    h.done = done;
    if (done) {
      const s = L.dayStats(data, day || h.date);
      if (s.total && s.done === s.total) toast(`${h.date === TODAY ? "오늘" : shortDay(h.date)} 숙제를 모두 끝냈어요! 🎉`);
    }
    save();
  }
  $("hwList").addEventListener("change", (e) => {
    const li = e.target.closest("li.hw");
    if (li && e.target.type === "checkbox") toggleHomework(li.dataset.id, e.target.checked);
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

  // week
  $("prevWeek").onclick = () => { selWeek = L.addDays(selWeek, -7); memoMode = null; editing = null; render(); };
  $("nextWeek").onclick = () => { selWeek = L.addDays(selWeek, 7); memoMode = null; editing = null; render(); };
  $("thisWeek").onclick = () => { selWeek = L.weekStart(TODAY); memoMode = null; editing = null; render(); };
  $("weekBoard").addEventListener("change", (e) => {
    const item = e.target.closest(".wday-item[data-id]");
    if (item) toggleHomework(item.dataset.id, e.target.checked);
  });
  $("weekBoard").addEventListener("click", (e) => {
    const add = e.target.closest("[data-addday]");
    if (!add) return;
    selDay = add.dataset.addday;
    selMonth = selDay.slice(0, 7);
    go("today");
    $("hwInput").focus();
  });

  $("noteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("noteText").value.trim();
    if (!text || !$("noteDate").value) return;
    data.notes.push({ id: L.uid(), date: $("noteDate").value, kind: $("noteKind").value, text, done: false });
    $("noteText").value = "";
    save();
  });
  $("noteList").addEventListener("change", (e) => {
    const li = e.target.closest("li.note");
    const n = li && data.notes.find((x) => x.id === li.dataset.id);
    if (!n) return;
    n.done = e.target.checked;
    save();
  });
  $("noteList").addEventListener("click", (e) => {
    if (!e.target.closest("[data-del]")) return;
    const id = e.target.closest("li").dataset.id;
    data.notes = data.notes.filter((x) => x.id !== id);
    save();
  });

  // memo editor / viewer
  $("tabEdit").onclick = () => { memoMode = "edit"; renderMemo(); $("memoEditor").focus(); };
  $("tabView").onclick = () => { memoMode = "view"; renderMemo(); };
  let memoTimer;
  $("memoEditor").addEventListener("input", () => {
    data.memos[selWeek] = $("memoEditor").value;
    clearTimeout(memoTimer);
    memoTimer = setTimeout(() => window.api.save(data), 400); // save without re-rendering so typing isn't interrupted
  });
  document.querySelectorAll("[data-insert]").forEach((b) => b.addEventListener("click", () => {
    const ed = $("memoEditor");
    const start = ed.value.lastIndexOf("\n", ed.selectionStart - 1) + 1;
    ed.setRangeText(b.dataset.insert, start, start, "end");
    ed.focus();
    ed.dispatchEvent(new Event("input"));
  }));

  // spreadsheet planner
  const grid = $("planGrid");
  grid.addEventListener("focusin", (e) => {
    const el = e.target.closest("input.xc");
    if (!el) return;
    planSel = { r: el.dataset.r, c: Number(el.dataset.c) };
    highlightSel();
  });
  grid.addEventListener("input", (e) => { if (e.target.matches("input.xc")) $("fxInput").value = e.target.value; });
  // Commit when leaving a cell, whether the value came from typing or the formula bar.
  grid.addEventListener("focusout", (e) => {
    if (e.target.matches("input.xc") && e.target.value !== e.target.defaultValue) commitCell(e.target);
  });
  grid.addEventListener("keydown", (e) => {
    const el = e.target.closest("input.xc");
    if (!el) return;
    const order = rowOrder();
    const ri = order.indexOf(el.dataset.r);
    const c = Number(el.dataset.c);
    const move = (dr, dc) => {
      const r2 = order[ri + dr];
      if (r2 === undefined) return false;
      return focusCell(r2, c + dc);
    };
    if (e.key === "Escape") { el.value = el.defaultValue; $("fxInput").value = el.value; e.preventDefault(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!move(e.shiftKey ? -1 : 1, 0) && el.value !== el.defaultValue) commitCell(el);
    } else if (e.key === "ArrowDown") { if (move(1, 0)) e.preventDefault(); }
    else if (e.key === "ArrowUp") { if (move(-1, 0)) e.preventDefault(); }
    else if (e.key === "ArrowRight" && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) { if (focusCell(el.dataset.r, c + 1)) e.preventDefault(); }
    else if (e.key === "ArrowLeft" && el.selectionStart === 0 && el.selectionEnd === 0) { if (focusCell(el.dataset.r, c - 1)) e.preventDefault(); }
  });
  $("fxInput").addEventListener("input", () => {
    const el = cellEl(planSel.r, planSel.c);
    if (el && !el.disabled) el.value = $("fxInput").value;
  });
  $("fxInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); const el = cellEl(planSel.r, planSel.c); if (el && el.value !== el.defaultValue) commitCell(el); }
  });
  $("fxInput").addEventListener("blur", () => { const el = cellEl(planSel.r, planSel.c); if (el && el.value !== el.defaultValue) commitCell(el); });

  const planGo = (ws) => { planWeek = ws; pendingRow = false; renderPlan(); };
  $("planPrev").onclick = () => planGo(L.addDays(planWeek, -7));
  $("planFwd").onclick = () => planGo(L.addDays(planWeek, 7));
  $("planThis").onclick = () => planGo(L.weekStart(TODAY));
  $("planNext").onclick = () => planGo(L.addDays(L.weekStart(TODAY), 7));
  $("manageDay").addEventListener("change", () => { data.settings.manageDay = Number($("manageDay").value); save(); });
  $("addRow").onclick = () => {
    pendingRow = true;
    renderPlan();
    const rows = rowOrder().filter((r) => r !== "note");
    focusCell(rows[rows.length - 1], 0);
  };
  $("copyPrev").onclick = () => {
    const prev = L.weekDays(L.addDays(planWeek, -7));
    let n = 0;
    for (const h of data.homework.filter((x) => prev.includes(x.date))) {
      const date = L.addDays(h.date, 7);
      if (data.homework.some((x) => x.date === date && (x.subject || "") === (h.subject || "") && x.title === h.title)) continue;
      data.homework.push({ id: L.uid(), date, subject: h.subject || "", title: h.title, done: false });
      n++;
    }
    if (n) logPlan();
    toast(n ? `지난주 계획 ${n}개를 불러왔어요.` : "불러올 새 계획이 없어요.");
    save();
  };

  // goals
  $("goalType").addEventListener("change", () => {
    const daily = $("goalType").value === "daily";
    $("goalTypeHelp").textContent = daily
      ? "매일 체크: 하루에 한 번 체크해서 목표 일수를 채워요."
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

  $("scaleUp").onclick = () => window.api.setScale((data.settings.uiScale || 1) + 0.1);
  $("scaleDown").onclick = () => window.api.setScale((data.settings.uiScale || 1) - 0.1);
  document.querySelectorAll(".nav button").forEach((b) => (b.title = b.querySelector(".t").textContent));
  $("themeToggle").onclick = () => { data.settings.theme = data.settings.theme === "dark" ? "light" : "dark"; save(); };
  $("widgetToggle").onclick = () => { data.settings.widgetOpen = !data.settings.widgetOpen; save(); };

  const normalize = (d) => ({
    ...d,
    notes: d.notes || [],
    memos: d.memos || {},
    planLog: d.planLog || {},
    plannerSubjects: d.plannerSubjects || ["국어", "수학", "영어", "과학", "사회"],
    settings: { manageDay: 0, ...d.settings },
  });
  window.api.onChange((next) => {
    data = normalize(next);
    const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches("input.xc, #fxInput, #memoEditor, .edit-row *");
    if (typing) renderChrome(); else render();
  });
  window.api.load().then((d) => { data = normalize(d); render(); });
  // Roll over to the new day if the app stays open past midnight.
  setInterval(() => {
    if (data && L.ymd(new Date()) !== TODAY) {
      selDay = L.ymd(new Date());
      selMonth = selDay.slice(0, 7);
      selWeek = L.weekStart(selDay);
      render();
    }
  }, 60000);
})();
