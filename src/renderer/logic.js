// Pure date and statistics helpers shared by the main window, the widget and the tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const parse = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d || 1);
  };
  const addDays = (s, n) => {
    const d = parse(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };
  const addMonths = (s, n) => {
    const d = parse(s + "-01");
    d.setMonth(d.getMonth() + n);
    return ym(d);
  };
  const daysInMonth = (month) => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  };
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function fmtDay(s) {
    const d = parse(s);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`;
  }

  // ----- week -----
  // Weeks run Monday to Sunday, as on a Korean school timetable.
  function weekStart(date) {
    const d = parse(date);
    const back = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - back);
    return ymd(d);
  }
  const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const dayDiff = (from, to) => Math.round((parse(to) - parse(from)) / 86400000);

  function dday(date, today) {
    const n = dayDiff(today, date);
    return n === 0 ? "D-day" : n > 0 ? `D-${n}` : `D+${-n}`;
  }

  // Cautions: tests, supplies, deadlines. Upcoming = not done and within `days` from today.
  const NOTE_KINDS = { test: "시험", supply: "준비물", due: "마감", etc: "기타" };
  function upcomingNotes(data, today, days = 7) {
    return (data.notes || [])
      .filter((n) => !n.done && dayDiff(today, n.date) >= 0 && dayDiff(today, n.date) <= days)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // Weekly memo markup: "# 제목", "- 목록", "! 중요", "[ ] 할 일", "[x] 한 일".
  function memoBlocks(text) {
    const blocks = [];
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) { blocks.push({ type: "gap" }); continue; }
      let m;
      if ((m = line.match(/^#\s+(.*)/))) blocks.push({ type: "heading", text: m[1] });
      else if ((m = line.match(/^!\s*(.*)/))) blocks.push({ type: "important", text: m[1] });
      else if ((m = line.match(/^\[( |x|X)\]\s*(.*)/))) blocks.push({ type: "task", done: m[1] !== " ", text: m[2] });
      else if ((m = line.match(/^[-*]\s+(.*)/))) blocks.push({ type: "item", text: m[1] });
      else blocks.push({ type: "text", text: line });
    }
    while (blocks.length && blocks[blocks.length - 1].type === "gap") blocks.pop();
    return blocks;
  }

  // ----- goals -----
  // A goal is either "count" (progress goes up with +1) or "daily" (one check per day).
  const goalProgress = (g) => (g.type === "daily" ? (g.checks || []).length : g.progress || 0);
  const goalRatio = (g) => Math.min(1, goalProgress(g) / g.target);

  function goalStatus(g, today) {
    const p = goalProgress(g);
    if (p >= g.target) return { cls: "good", text: "달성" };
    const nowM = today.slice(0, 7);
    if (g.month < nowM) return { cls: "behind", text: "미달성" };
    if (g.month > nowM) return { cls: "neutral", text: "예정" };
    const expected = (g.target * Number(today.slice(8))) / daysInMonth(g.month);
    if (p >= expected) return { cls: "good", text: "순조로움" };
    if (p >= expected * 0.6) return { cls: "warn", text: "조금 늦음" };
    return { cls: "behind", text: "분발 필요" };
  }

  function monthSummary(data, month) {
    const goals = data.goals.filter((g) => g.month === month);
    const hw = data.homework.filter((h) => h.date.startsWith(month));
    return {
      goals,
      goalRate: goals.length ? goals.reduce((a, g) => a + goalRatio(g), 0) / goals.length : null,
      goalsDone: goals.filter((g) => goalProgress(g) >= g.target).length,
      hwTotal: hw.length,
      hwDone: hw.filter((h) => h.done).length,
    };
  }

  // ----- homework -----
  function dayStats(data, date) {
    const items = data.homework.filter((h) => h.date === date);
    const done = items.filter((h) => h.done).length;
    return { items, done, total: items.length, ratio: items.length ? done / items.length : null };
  }

  function subjectStats(data, month) {
    const map = new Map();
    for (const h of data.homework) {
      if (month && !h.date.startsWith(month)) continue;
      const key = h.subject || "기타";
      const s = map.get(key) || { subject: key, total: 0, done: 0 };
      s.total++;
      if (h.done) s.done++;
      map.set(key, s);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject));
  }

  // A "perfect day" has at least one homework and all of it done.
  // Days without homework do not break a streak and do not add to it.
  function streaks(data, today) {
    const byDay = new Map();
    for (const h of data.homework) {
      if (h.date > today) continue;
      const s = byDay.get(h.date) || { total: 0, done: 0 };
      s.total++;
      if (h.done) s.done++;
      byDay.set(h.date, s);
    }
    const days = [...byDay.keys()].sort();
    const perfect = (d) => {
      const s = byDay.get(d);
      return s && s.done === s.total;
    };

    let best = 0;
    let run = 0;
    for (const d of days) {
      run = perfect(d) ? run + 1 : 0;
      best = Math.max(best, run);
    }

    // Current streak: walk back from the latest day. Today still in progress doesn't break it.
    let current = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      if (perfect(d)) current++;
      else if (d === today) continue;
      else break;
    }
    return { current, best, perfectDays: days.filter(perfect).length };
  }

  // ----- badges -----
  const BADGES = [
    { id: "first", icon: "✏️", name: "첫 걸음", desc: "숙제를 처음으로 끝냈어요", test: (s) => s.hwDone >= 1 },
    { id: "streak3", icon: "🔥", name: "3일 연속", desc: "3일 연속 숙제를 모두 끝냈어요", test: (s) => s.best >= 3 },
    { id: "streak7", icon: "⚡", name: "일주일 연속", desc: "7일 연속 숙제를 모두 끝냈어요", test: (s) => s.best >= 7 },
    { id: "streak30", icon: "👑", name: "한 달 연속", desc: "30일 연속 숙제를 모두 끝냈어요", test: (s) => s.best >= 30 },
    { id: "hw50", icon: "📚", name: "숙제 50개", desc: "숙제를 50개 끝냈어요", test: (s) => s.hwDone >= 50 },
    { id: "hw200", icon: "🏛️", name: "숙제 200개", desc: "숙제를 200개 끝냈어요", test: (s) => s.hwDone >= 200 },
    { id: "busy", icon: "💪", name: "바쁜 하루 완주", desc: "하루에 숙제 5개 이상을 모두 끝냈어요", test: (s) => s.bigDay },
    { id: "goal1", icon: "🎯", name: "첫 목표 달성", desc: "목표를 하나 달성했어요", test: (s) => s.goalsDone >= 1 },
    { id: "goal10", icon: "🏅", name: "목표 10개", desc: "목표를 10개 달성했어요", test: (s) => s.goalsDone >= 10 },
    { id: "allgoals", icon: "🌟", name: "완벽한 달", desc: "한 달 목표(3개 이상)를 전부 달성했어요", test: (s) => s.perfectMonth },
  ];

  function badgeStats(data, today) {
    const st = streaks(data, today);
    const perDay = new Map();
    for (const h of data.homework) {
      const s = perDay.get(h.date) || { total: 0, done: 0 };
      s.total++;
      if (h.done) s.done++;
      perDay.set(h.date, s);
    }
    const months = new Map();
    for (const g of data.goals) {
      const list = months.get(g.month) || [];
      list.push(g);
      months.set(g.month, list);
    }
    return {
      ...st,
      hwDone: data.homework.filter((h) => h.done).length,
      bigDay: [...perDay.values()].some((s) => s.total >= 5 && s.done === s.total),
      goalsDone: data.goals.filter((g) => goalProgress(g) >= g.target).length,
      perfectMonth: [...months.values()].some((l) => l.length >= 3 && l.every((g) => goalProgress(g) >= g.target)),
    };
  }

  function badges(data, today) {
    const s = badgeStats(data, today);
    return BADGES.map((b) => ({ ...b, earned: !!b.test(s) }));
  }

  // ----- sample data -----
  function sampleData(today) {
    const m = today.slice(0, 7);
    const subjects = [["국어", "받아쓰기 연습"], ["수학", "익힘책 풀기"], ["영어", "단어 20개 외우기"], ["과학", "실험 보고서"], ["사회", "지도 그리기"]];
    const homework = [];
    const todayN = Number(today.slice(8));
    for (let d = 1; d < todayN; d++) {
      const day = `${m}-${pad(d)}`;
      const n = 1 + (d % 3);
      for (let i = 0; i < n; i++) {
        const [s, t] = subjects[(d + i) % subjects.length];
        homework.push({ id: uid(), date: day, subject: s, title: t, done: d > todayN - 5 || (d * 7 + i * 3) % 5 !== 0 });
      }
    }
    homework.push({ id: uid(), date: today, subject: "수학", title: "익힘책 24~26쪽", done: true });
    homework.push({ id: uid(), date: today, subject: "영어", title: "Unit 5 단어 외우기", done: false });
    homework.push({ id: uid(), date: today, subject: "국어", title: "독서록 한 편 쓰기", done: false });
    const checks = [];
    for (let d = 1; d < todayN; d++) if (d % 4 !== 0) checks.push(`${m}-${pad(d)}`);
    const ws = weekStart(today);
    return {
      homework,
      notes: [
        { id: uid(), date: addDays(today, 2), kind: "test", text: "수학 단원평가 (3단원 분수)", done: false },
        { id: uid(), date: addDays(today, 1), kind: "supply", text: "색종이, 풀 (미술)", done: false },
        { id: uid(), date: addDays(today, 4), kind: "due", text: "과학 탐구 보고서 제출", done: false },
      ],
      memos: {
        [ws]: "# 이번 주 목표\n- 수학 3단원 다시 풀어보기\n- 영어 단어 매일 20개\n! 목요일 수학 시험 범위 확인하기\n[x] 독서록 공책 사기\n[ ] 체육복 챙기기",
      },
      goals: [
        { id: uid(), month: m, type: "count", title: "책 읽기", target: 4, unit: "권", progress: 2 },
        { id: uid(), month: m, type: "daily", title: "줄넘기 100번", target: 20, unit: "일", checks },
        { id: uid(), month: m, type: "count", title: "영어 일기", target: 8, unit: "편", progress: 8 },
      ],
    };
  }

  return {
    pad, ymd, ym, parse, addDays, addMonths, daysInMonth, DOW, uid, fmtDay,
    weekStart, weekDays, dayDiff, dday, NOTE_KINDS, upcomingNotes, memoBlocks,
    goalProgress, goalRatio, goalStatus, monthSummary, dayStats, subjectStats, streaks, badges, sampleData,
  };
});
