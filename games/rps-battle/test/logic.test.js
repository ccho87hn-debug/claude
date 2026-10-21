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

test("random lineups always include every type within bounds", () => {
  assert.deepEqual(RPS.randomLineup(() => 0), { rock: 3, paper: 3, scissors: 3 });
  assert.deepEqual(RPS.randomLineup(() => 0.9999), { rock: 25, paper: 25, scissors: 25 });
  for (let i = 0; i < 200; i++) {
    const c = RPS.randomLineup();
    for (const t of RPS.TYPES) assert.ok(c[t] >= RPS.LINEUP_MIN && c[t] <= RPS.LINEUP_MAX);
  }
});

test("settle pays winners at the lineup's odds and takes losers' bets", () => {
  const lineup = { rock: 10, paper: 10, scissors: 10 };
  assert.deepEqual(RPS.settle({ pick: "rock", bet: 100 }, lineup, "rock"), { won: true, returned: 270, delta: 170 });
  assert.deepEqual(RPS.settle({ pick: "paper", bet: 100 }, lineup, "rock"), { won: false, returned: 0, delta: -100 });
  assert.deepEqual(RPS.settle({ pick: "rock", bet: 0 }, lineup, "rock"), { won: true, returned: 0, delta: 0 });
});

test("room codes are five readable characters and normalize from typed input", () => {
  assert.equal(RPS.makeRoomCode(() => 0), "AAAAA");
  for (let i = 0; i < 100; i++) assert.match(RPS.makeRoomCode(), /^[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(RPS.normalizeCode(" ab-c 12 "), "ABC12");
  assert.equal(RPS.normalizeCode(undefined), "");
});

test("units survive a pack/unpack round trip", () => {
  const units = [{ x: 10.4, y: 20.6, type: "paper" }, { x: 1, y: 2, type: "scissors" }];
  assert.deepEqual(RPS.packUnits(units), [10, 21, 1, 1, 2, 2]);
  assert.deepEqual(RPS.unpackUnits(RPS.packUnits(units)), [{ x: 10, y: 21, type: "paper" }, { x: 1, y: 2, type: "scissors" }]);
});
