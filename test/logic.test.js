const test = require("node:test");
const assert = require("node:assert");
const L = require("../src/renderer/logic.js");

const hw = (date, done, subject = "수학") => ({ id: date + Math.random(), date, subject, title: "t", done });

test("date helpers handle month and year boundaries", () => {
  assert.strictEqual(L.addDays("2026-10-31", 1), "2026-11-01");
  assert.strictEqual(L.addMonths("2026-12", 1), "2027-01");
  assert.strictEqual(L.daysInMonth("2028-02"), 29);
});

test("streak skips days without homework and ignores an unfinished today", () => {
  const data = { goals: [], homework: [
    hw("2026-10-10", false),
    hw("2026-10-12", true), hw("2026-10-14", true), hw("2026-10-15", true),
    hw("2026-10-18", false),
  ] };
  const s = L.streaks(data, "2026-10-18");
  assert.strictEqual(s.current, 3);
  assert.strictEqual(s.best, 3);
});

test("streak breaks on an unfinished past day", () => {
  const data = { goals: [], homework: [hw("2026-10-15", true), hw("2026-10-16", false), hw("2026-10-17", true)] };
  assert.strictEqual(L.streaks(data, "2026-10-18").current, 1);
});

test("goal progress for count and daily goals", () => {
  const count = { month: "2026-10", type: "count", target: 4, progress: 2 };
  const daily = { month: "2026-10", type: "daily", target: 10, checks: ["2026-10-01", "2026-10-02"] };
  assert.strictEqual(L.goalRatio(count), 0.5);
  assert.strictEqual(L.goalProgress(daily), 2);
  const sum = L.monthSummary({ goals: [count, daily], homework: [] }, "2026-10");
  assert.strictEqual(sum.goalRate, (0.5 + 0.2) / 2);
  assert.strictEqual(L.goalStatus({ ...count, progress: 4 }, "2026-10-18").text, "달성");
});

test("subject stats group and count", () => {
  const data = { goals: [], homework: [hw("2026-10-01", true, "국어"), hw("2026-10-02", false, "국어"), hw("2026-10-02", true, "")] };
  const s = L.subjectStats(data, "2026-10");
  assert.deepStrictEqual(s.map((x) => [x.subject, x.done, x.total]), [["국어", 1, 2], ["기타", 1, 1]]);
});

test("sample data earns some badges", () => {
  const data = L.sampleData("2026-10-18");
  const earned = L.badges(data, "2026-10-18").filter((b) => b.earned).map((b) => b.id);
  assert.ok(earned.includes("first"));
  assert.ok(earned.includes("goal1"));
});

test("weeks start on Monday", () => {
  assert.strictEqual(L.weekStart("2026-10-18"), "2026-10-12"); // Sunday
  assert.strictEqual(L.weekStart("2026-10-19"), "2026-10-19"); // Monday
  assert.strictEqual(L.weekDays("2026-10-26")[6], "2026-11-01");
});

test("d-day labels and upcoming cautions", () => {
  assert.strictEqual(L.dday("2026-10-20", "2026-10-18"), "D-2");
  assert.strictEqual(L.dday("2026-10-18", "2026-10-18"), "D-day");
  const data = { notes: [
    { id: 1, date: "2026-10-30", done: false }, { id: 2, date: "2026-10-19", done: false },
    { id: 3, date: "2026-10-20", done: true }, { id: 4, date: "2026-10-17", done: false },
  ] };
  assert.deepStrictEqual(L.upcomingNotes(data, "2026-10-18").map((n) => n.id), [2]);
});

test("memo markup is split into blocks", () => {
  const b = L.memoBlocks("# 제목\n- 하나\n! 중요\n[x] 완료\n[ ] 미완료\n그냥 글\n\n");
  assert.deepStrictEqual(b.map((x) => x.type), ["heading", "item", "important", "task", "task", "text"]);
  assert.strictEqual(b[3].done, true);
  assert.strictEqual(b[4].done, false);
});

test("planner cell keeps done items and adds or removes others", () => {
  let n = 0;
  const id = () => "new" + n++;
  const data = { homework: [
    { id: "a", date: "2026-10-20", subject: "수학", title: "익힘책", done: true },
    { id: "b", date: "2026-10-20", subject: "수학", title: "학습지", done: false },
    { id: "c", date: "2026-10-20", subject: "국어", title: "받아쓰기", done: false },
  ] };
  assert.strictEqual(L.cellText(data, "2026-10-20", "수학"), "익힘책; 학습지");
  L.applyCell(data, "2026-10-20", "수학", "익힘책 ; 오답노트", id);
  const math = L.cellItems(data, "2026-10-20", "수학");
  assert.deepStrictEqual(math.map((h) => [h.title, h.done]), [["익힘책", true], ["오답노트", false]]);
  assert.strictEqual(data.homework.length, 3);
  L.applyCell(data, "2026-10-20", "수학", "", id);
  assert.strictEqual(L.cellItems(data, "2026-10-20", "수학").length, 0);
  assert.ok(data.homework.some((h) => h.id === "c"));
});

test("planner rows include saved subjects then this week's others, blank last", () => {
  const data = { plannerSubjects: ["국어", "수학"], homework: [
    { date: "2026-10-21", subject: "", title: "x" }, { date: "2026-10-22", subject: "미술", title: "y" },
    { date: "2026-11-30", subject: "체육", title: "z" },
  ] };
  assert.deepStrictEqual(L.plannerRows(data, "2026-10-19"), ["국어", "수학", "미술", ""]);
});

test("management day plans next week", () => {
  // 2026-10-18 is a Sunday, 2026-10-16 a Friday
  assert.strictEqual(L.planWeekFor("2026-10-18", 0), "2026-10-19");
  assert.strictEqual(L.planWeekFor("2026-10-14", 0), "2026-10-12");
  assert.strictEqual(L.planWeekFor("2026-10-16", 5), "2026-10-19");
  assert.strictEqual(L.planWeekFor("2026-10-17", 5), "2026-10-19");
  assert.ok(L.isManageDay("2026-10-18", 0));
});

test("planning badges count logged weeks", () => {
  const data = { homework: [], goals: [], notes: [], memos: {}, planLog: { "2026-10-19": { onManageDay: true }, "2026-10-26": { onManageDay: false } } };
  const earned = L.badges(data, "2026-10-18").filter((b) => b.earned).map((b) => b.id);
  assert.ok(earned.includes("plan1") && earned.includes("manage") && !earned.includes("plan4"));
});
