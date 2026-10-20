const test = require("node:test");
const assert = require("node:assert/strict");
const RPS = require("../renderer/logic.js");

test("clash follows rock-paper-scissors", () => {
  assert.equal(RPS.clash("scissors", "paper"), "scissors");
  assert.equal(RPS.clash("paper", "scissors"), "scissors");
  assert.equal(RPS.clash("paper", "rock"), "paper");
  assert.equal(RPS.clash("rock", "scissors"), "rock");
  assert.equal(RPS.clash("rock", "rock"), "rock");
});

test("rarer types pay more", () => {
  const counts = { rock: 10, paper: 10, scissors: 10 };
  assert.equal(RPS.odds(counts, "rock"), 2.7);
  const skewed = { rock: 2, paper: 20, scissors: 18 };
  assert.ok(RPS.odds(skewed, "rock") > RPS.odds(skewed, "paper"));
  assert.equal(RPS.odds(skewed, "rock"), 18);
  assert.equal(RPS.payout(100, counts, "paper"), 270);
});

test("odds have a floor and are zero when there is nothing to bet on", () => {
  assert.equal(RPS.odds({ rock: 49, paper: 1, scissors: 0 }, "rock"), 1.1);
  assert.equal(RPS.odds({ rock: 0, paper: 5, scissors: 5 }, "rock"), 0);
  assert.equal(RPS.odds({ rock: 5, paper: 0, scissors: 0 }, "rock"), 0);
});

test("validate catches bad setups", () => {
  const ok = { counts: { rock: 5, paper: 5, scissors: 5 }, pick: "rock", bet: 50, coins: 100 };
  assert.equal(RPS.validate(ok), "");
  assert.notEqual(RPS.validate({ ...ok, counts: { rock: 5, paper: 0, scissors: 0 } }), "");
  assert.notEqual(RPS.validate({ ...ok, pick: null }), "");
  assert.notEqual(RPS.validate({ ...ok, counts: { rock: 0, paper: 5, scissors: 5 } }), "");
  assert.notEqual(RPS.validate({ ...ok, bet: 101 }), "");
  assert.notEqual(RPS.validate({ ...ok, bet: -1 }), "");
  assert.equal(RPS.validate({ ...ok, bet: 0 }), "");
});

test("survivors reports the last type standing", () => {
  assert.equal(RPS.survivors([{ type: "rock" }, { type: "paper" }]), null);
  assert.equal(RPS.survivors([{ type: "paper" }, { type: "paper" }]), "paper");
});
