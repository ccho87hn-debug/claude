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
