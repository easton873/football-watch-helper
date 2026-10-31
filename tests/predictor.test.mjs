// Run with: node tests/predictor.test.mjs   (port of test_predictor.py)
import assert from "node:assert/strict";
import { Predictor, pick, LIVE, AD } from "../docs/predictor.js";

const g = (playId, playType, o = {}) => ({
  id: "1", name: "A @ B", state: "in", status: "STATUS_IN_PROGRESS", detail: "",
  clock: 500, period: 2, teams: [], playId, playType, playText: "", channel: "", ...o,
});

function run(events, at, delay = 0) {
  const p = new Predictor(delay);
  for (const [t, game] of events) p.observe([game], t);
  return p.predict("1", at)[0];
}

const tests = {
  live_play() { assert.equal(run([[0, g("a", "Rush")]], 5), LIVE); },
  ad_after_touchdown_then_ends() {
    const ev = [[0, g("a", "Rush")], [10, g("b", "Rushing Touchdown")], [60, g("c", "Kickoff")]];
    assert.equal(run(ev.slice(0, 2), 40), AD);
    assert.equal(run(ev, 62), LIVE);
  },
  delay_shifts_view() {
    const ev = [[0, g("a", "Rush")], [10, g("b", "Timeout")]];
    assert.equal(run(ev, 20, 15), LIVE);
    assert.equal(run(ev, 30, 15), AD);
  },
  stall_is_ad() { assert.equal(run([[0, g("a", "Rush")], [100, g("a", "Rush")]], 100), AD); },
  halftime() { assert.equal(run([[0, g("a", "End Period", { status: "STATUS_HALFTIME" })]], 1), AD); },
  pick_priority() {
    const m = new Map([["1", [AD]], ["2", [LIVE]], ["3", [LIVE]]]);
    assert.equal(pick(["1", "2", "3"], m), "2");
    assert.equal(pick(["1"], new Map([["1", [AD]]])), null);
  },
  clock_moving_ends_review_ad() {
    const r = (id, c) => g(id, "Pass Reception", { clock: c, playText: "under review" });
    const ev = [[0, g("a", "Rush")], [10, r("b", 500)], [40, r("b", 500)], [50, r("b", 490)]];
    assert.equal(run(ev.slice(0, 3), 41), AD);
    assert.equal(run(ev, 51), LIVE);
  },
  quarter_break_survives_period_flip() {
    const ev = [[0, g("a", "Rush", { clock: 30, period: 3 })],
      [10, g("b", "End Period", { clock: 0, period: 3 })],
      [20, g("b", "End Period", { clock: 900, period: 4 })],
      [200, g("b", "End Period", { clock: 900, period: 4 })]];
    assert.equal(run(ev, 21), AD);
    assert.equal(run(ev, 201), AD);
    ev.push([210, g("c", "Kickoff", { clock: 900, period: 4 })]);
    assert.equal(run(ev, 211), LIVE);
  },
  turnover_followed_quickly_is_not_an_ad() {
    const ev = [[0, g("a", "Rush")], [10, g("b", "Interception")], [40, g("c", "Rush")]];
    assert.equal(run(ev, 12), LIVE);
    assert.equal(run(ev, 41), LIVE);
  },
  turnover_with_long_gap_is_an_ad() {
    const ev = [[0, g("a", "Rush")], [10, g("b", "Punt")]];
    assert.equal(run(ev, 30), LIVE);
    assert.equal(run(ev, 60), AD);
  },
  confirmed_punt_ad_does_not_expire_before_stall() {
    const ev = [[0, g("a", "Rush")], [10, g("b", "Punt")]];
    assert.equal(run(ev, 60), AD);
    assert.equal(run(ev, 85), AD);
  },
  two_minute_stoppage() {
    const c = (id, clock) => g(id, "Rush", { clock, period: 4 });
    const ev = [[0, c("a", 140)], [10, c("b", 120)], [14, c("b", 120)], [30, c("b", 120)]];
    assert.equal(run(ev.slice(0, 2), 12), LIVE);
    assert.equal(run(ev, 31), AD);
    ev.push([40, c("c", 112)]);
    assert.equal(run(ev, 41), LIVE);
  },
  two_minute_ignored_in_other_quarters() {
    const c = g("a", "Rush", { clock: 120, period: 3 });
    assert.equal(run([[0, c], [30, c]], 31), LIVE);
  },
  return_countdown_uses_lookahead() {
    const ev = [[0, g("a", "Rush")], [10, g("b", "Timeout")], [50, g("c", "Rush", { clock: 495 })]];
    const p = new Predictor(30);
    for (const [t, game] of ev) p.observe([game], t);
    assert.equal(p.predict("1", 55)[0], AD);
    assert.equal(p.returnIn("1", 55), 25);
    const p2 = new Predictor(30);
    for (const [t, game] of ev.slice(0, 2)) p2.observe([game], t);
    assert.equal(p2.predict("1", 45)[0], AD);
    assert.equal(p2.returnIn("1", 45), null);
  },
  overtime_break_survives_period_change() {
    const e = (id, period) => g(id, "End of Regulation", { clock: 0, period });
    const ev = [[0, g("a", "Rush", { clock: 20, period: 4 })], [10, e("b", 4)], [20, e("b", 5)], [300, e("b", 5)]];
    assert.equal(run(ev, 21), AD);
    assert.equal(run(ev, 301), AD);
    ev.push([310, g("c", "Rush", { clock: 0, period: 5 })]);
    assert.equal(run(ev, 311), LIVE);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log("ok  ", name); }
  catch (e) { failed++; console.log("FAIL", name, "-", e.message); }
}
process.exit(failed ? 1 : 0);
