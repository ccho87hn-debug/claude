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

test("skins: every skin covers all three hands and the free one comes first", () => {
  assert.equal(RPS.SKINS[0].price, 0);
  for (const k of RPS.SKINS) for (const t of RPS.TYPES) assert.ok(k.glyphs[t]);
  assert.deepEqual(RPS.skinById("numbers").glyphs, { rock: "0", paper: "5", scissors: "2" });
  assert.equal(RPS.skinById("nope").id, "classic");
});

test("buySkin takes the price once and refuses what can't be bought", () => {
  assert.deepEqual(RPS.buySkin({ coins: 1000, skins: { classic: true } }, "numbers"), { coins: 700, skins: { classic: true, numbers: true } });
  assert.match(RPS.buySkin({ coins: 1000, skins: { numbers: true } }, "numbers").error, /이미/);
  assert.match(RPS.buySkin({ coins: 100, skins: {} }, "numbers").error, /200개 모자라요/);
  assert.ok(RPS.buySkin({ coins: 100, skins: {} }, "lizard").error);
  assert.deepEqual(RPS.buySkin({ coins: 0 }, "classic"), { coins: 0, skins: { classic: true } });
});

test("settlePot gives the whole pot to whoever backed the winner", () => {
  const two = RPS.settlePot({ a: { rock: 0, paper: 100, scissors: 0 }, b: { rock: 0, paper: 0, scissors: 100 } }, "scissors");
  assert.deepEqual(two.a, { total: 100, returned: 0, delta: -100, won: false });
  assert.deepEqual(two.b, { total: 100, returned: 200, delta: 100, won: true });
  // two winners split by what they put on the winner
  const three = RPS.settlePot({ a: { rock: 0, paper: 300, scissors: 0 }, b: { rock: 0, paper: 0, scissors: 100 }, c: { rock: 0, paper: 0, scissors: 200 } }, "scissors");
  assert.equal(three.b.returned, 200);
  assert.equal(three.c.returned, 400);
  // everyone on the same side just shares their own coins back
  const same = RPS.settlePot({ a: { rock: 50, paper: 0, scissors: 0 }, b: { rock: 150, paper: 0, scissors: 0 } }, "rock");
  assert.deepEqual([same.a.returned, same.b.returned], [50, 150]);
  // nobody backed the winner: all refunded
  const none = RPS.settlePot({ a: { rock: 50, paper: 0, scissors: 0 } }, "paper");
  assert.deepEqual(none.a, { total: 50, returned: 50, delta: 0, won: false });
  // rounding never loses coins
  const odd = RPS.settlePot({ a: { rock: 1, paper: 0, scissors: 0 }, b: { rock: 1, paper: 0, scissors: 0 }, c: { rock: 0, paper: 1, scissors: 0 }, d: { rock: 1, paper: 0, scissors: 0 } }, "rock");
  assert.equal(Object.values(odd).reduce((s, r) => s + r.returned, 0), 4);
});

test("stock prices are the same for the same moment and stay positive", () => {
  assert.ok(RPS.STOCKS.length >= 30);
  assert.equal(new Set(RPS.STOCKS.map((k) => k.id)).size, RPS.STOCKS.length);
  const k = RPS.stockById("meme");
  for (let t = 0; t < 5000; t++) assert.ok(RPS.stockPrice(k, t) >= 1);
  assert.equal(RPS.stockPrice(k, 123456), RPS.stockPrice(k, 123456));
  assert.equal(RPS.stockTick(10000), 2);
});

test("buying and selling stocks charges the 1% fee and tracks cost", () => {
  const b = RPS.buyStock({ coins: 1000, stocks: {} }, "meme", 10, 50);
  assert.deepEqual(b, { coins: 495, stocks: { meme: { qty: 10, cost: 505 } }, paid: 505 });
  assert.match(RPS.buyStock({ coins: 100, stocks: {} }, "meme", 10, 50).error, /모자라요/);
  const half = RPS.sellStock(b, "meme", 5, 100);
  assert.equal(half.coins, 495 + 495);
  assert.deepEqual(half.stocks.meme, { qty: 5, cost: 253 });
  assert.deepEqual(RPS.sellStock(half, "meme", 5, 100).stocks, {});
  assert.ok(RPS.sellStock(half, "meme", 6, 100).error);
  assert.equal(RPS.maxBuy(1000, 99), 10);
  assert.ok(RPS.buyStock({ coins: 1000, stocks: {} }, "meme", RPS.maxBuy(1000, 99), 99).coins >= 0);
});

test("loans have a limit, grow 3% every 10 minutes and can be repaid", () => {
  assert.deepEqual(RPS.borrow({ coins: 0, debt: 0 }, 1000), { coins: 1000, debt: 1000 });
  assert.ok(RPS.borrow({ coins: 0, debt: 4500 }, 1000).error);
  const t0 = 1_000_000;
  assert.deepEqual(RPS.accrueDebt({ debt: 1000, debtAt: t0 }, t0 + 5 * 60 * 1000), { debt: 1000, debtAt: t0 });
  assert.deepEqual(RPS.accrueDebt({ debt: 1000, debtAt: t0 }, t0 + 25 * 60 * 1000), { debt: 1061, debtAt: t0 + 20 * 60 * 1000 });
  assert.deepEqual(RPS.repay({ coins: 2000, debt: 1061 }, 5000), { coins: 939, debt: 0 });
  assert.ok(RPS.repay({ coins: 10, debt: 100 }, 100).error);
  assert.equal(RPS.canGoBankrupt({ coins: 0, debt: 5000, stocks: {} }), true);
  assert.equal(RPS.canGoBankrupt({ coins: 0, debt: 4000, stocks: {} }), false);
});
