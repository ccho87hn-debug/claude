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

test("validateSlip catches bad slips", () => {
  const counts = { rock: 5, paper: 5, scissors: 0 };
  const ok = { counts, slip: { rock: 50, paper: 20, scissors: 0 }, coins: 100 };
  assert.equal(RPS.validateSlip(ok), "");
  assert.notEqual(RPS.validateSlip({ ...ok, slip: RPS.emptySlip() }), "");
  assert.notEqual(RPS.validateSlip({ ...ok, slip: { rock: 0, paper: 0, scissors: 10 } }), "");
  assert.notEqual(RPS.validateSlip({ ...ok, slip: { rock: 81, paper: 20, scissors: 0 } }), "");
  assert.notEqual(RPS.validateSlip({ ...ok, slip: { rock: -1, paper: 20, scissors: 0 } }), "");
  assert.equal(RPS.validateSlip({ ...ok, slip: { rock: 80, paper: 20, scissors: 0 } }), "");
});

test("cleanSlip keeps only positive whole amounts on real sides", () => {
  assert.deepEqual(RPS.cleanSlip({ rock: "30", paper: -5, scissors: 2.9, lizard: 9 }), { rock: 30, paper: 0, scissors: 2 });
  assert.deepEqual(RPS.cleanSlip(null), RPS.emptySlip());
});

test("quick amounts are shares of the wallet capped by what is still free", () => {
  assert.equal(RPS.quickAmount("third", 900, 0), 300);
  assert.equal(RPS.quickAmount("half", 900, 0), 450);
  assert.equal(RPS.quickAmount("all", 900, 200), 700);
  assert.equal(RPS.quickAmount("half", 900, 600), 300);
  assert.equal(RPS.quickAmount("third", 10, 10), 0);
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

test("settle pays the winning side of a slip and loses the rest", () => {
  const lineup = { rock: 10, paper: 10, scissors: 10 };
  assert.deepEqual(RPS.settle({ rock: 100, paper: 0, scissors: 0 }, lineup, "rock"), { total: 100, returned: 270, delta: 170, won: true });
  assert.deepEqual(RPS.settle({ rock: 0, paper: 100, scissors: 0 }, lineup, "rock"), { total: 100, returned: 0, delta: -100, won: false });
  // backing two sides: one pays, the other is lost
  assert.deepEqual(RPS.settle({ rock: 100, paper: 100, scissors: 0 }, lineup, "paper"), { total: 200, returned: 270, delta: 70, won: true });
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
