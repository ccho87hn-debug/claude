(() => {
  const L = window.Logic;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let data = null;

  function render() {
    const today = L.ymd(new Date());
    document.documentElement.dataset.theme = data.settings.theme;
    $("wDate").textContent = L.fmtDay(today);

    const s = L.dayStats(data, today);
    $("wRing").setAttribute("stroke-dashoffset", (263.9 * (1 - (s.ratio || 0))).toFixed(1));
    $("wRingText").textContent = s.ratio == null ? "–" : Math.round(s.ratio * 100) + "%";
    $("wCount").textContent = `${s.done} / ${s.total} 완료`;
    const left = s.total - s.done;
    $("wLeft").textContent = !s.total ? "오늘 숙제가 없어요" : left ? `남은 숙제 ${left}개` : "다 끝냈어요!";

    // Unfinished first so what's left stays at the top.
    const items = [...s.items].sort((a, b) => a.done - b.done);
    $("wList").innerHTML = items.length
      ? items.map((h) => `
        <li class="hw${h.done ? " done" : ""}" data-id="${h.id}">
          <input type="checkbox" id="w-${h.id}" ${h.done ? "checked" : ""}>
          <label class="title" for="w-${h.id}">${h.subject ? `<span class="chip">${esc(h.subject)}</span> ` : ""}${esc(h.title)}</label>
        </li>`).join("")
      : `<li class="empty">앱에서 숙제를 추가해 보세요.</li>`;

    const m = L.monthSummary(data, today.slice(0, 7));
    $("wGoal").textContent = m.goalRate == null ? "–" : `${Math.round(m.goalRate * 100)}%`;
    $("wStreak").textContent = L.streaks(data, today).current + "일";
  }

  $("wList").addEventListener("change", (e) => {
    const li = e.target.closest("li[data-id]");
    const h = li && data.homework.find((x) => x.id === li.dataset.id);
    if (!h) return;
    h.done = e.target.checked;
    window.api.save(data);
    render();
  });
  $("wClose").onclick = () => window.api.closeWidget();
  $("wOpen").onclick = () => window.api.showMain();

  window.api.onChange((next) => { data = next; render(); });
  window.api.load().then((d) => { data = d; render(); });
  setInterval(() => data && render(), 60000);
})();
