// Predict whether a game is currently in a commercial break.
// Direct port of predictor.py: keep the two in sync.
//
// Each poll we record a snapshot of every game. Because the TV stream runs behind ESPN's
// feed, we judge a game as it looked `delay` seconds ago. Times are in seconds.

// [keyword in play type, expected ad seconds]. First match wins.
const AD_RULES = [
  ["timeout", 120], ["end period", 120], ["end of", 120], ["review", 120],
  ["touchdown", 100], ["field goal good", 100], ["safety", 100],
  ["extra point", 60], ["punt", 60], ["interception", 75],
  ["fumble recovery (opponent)", 75], ["field goal missed", 60],
];
export const STALL_SECONDS = 90;
// Turnovers, punts and missed FGs usually go straight to the next snap. Only call an ad
// if the feed takes at least this long (real seconds) to post the next play.
const SOFT_TRIGGERS = ["interception", "fumble recovery", "punt", "field goal missed"];
const SOFT_CONFIRM_SECONDS = 45;
// Two-minute stoppage: ESPN parks the clock at exactly 2:00 in the 2nd/4th quarter.
const TWO_MIN_FROZEN_SECONDS = 8;

export const LIVE = "LIVE", AD = "AD", WAIT = "WAIT", UNKNOWN = "UNKNOWN";

// End Period, End of Regulation, End of Half... but not End of Game.
export function isPeriodEnd(playType) {
  const t = playType.toLowerCase();
  return (t === "end period" || t.startsWith("end of")) && !t.includes("game");
}

function classifyPlay(playType, playText) {
  const t = playType.toLowerCase();
  for (const [kw, secs] of AD_RULES) if (t.includes(kw)) return secs;
  // fall back to text only for reviews/timeouts, which can hide in other play types
  const x = playText.toLowerCase();
  if (x.includes("timeout") || x.includes("under review") || x.includes("official review")) return 90;
  return 0;
}

const key = (g) => `${g.id}:${g.playId}`;

export class Predictor {
  constructor(delay = 30) {
    this.delay = delay;
    this.history = new Map();    // game id -> [[t, game], ...]
    this.firstSeen = new Map();  // "id:playId" -> t
    this.firstClock = new Map(); // "id:playId" -> [period, clock]
    this.initial = new Set();    // plays already live at startup
    this.viewed = new Map();     // game id -> game as of the delayed view
    this.adSince = new Map();    // game id -> time the ad began
    this._age = 0;
  }

  hist(id) {
    if (!this.history.has(id)) this.history.set(id, []);
    return this.history.get(id);
  }

  observe(games, now) {
    for (const g of games) {
      const h = this.hist(g.id);
      // a play already underway when we started has an unknown true age
      if (h.length === 0) this.initial.add(key(g));
      h.push([now, g]);
      if (h.length > 2000) h.shift();
      if (!this.firstSeen.has(key(g))) {
        this.firstClock.set(key(g), [g.period, g.clock]);
        this.firstSeen.set(key(g), now);
      }
    }
  }

  // -> [state, reason, secondsLeftInAdOrNull]
  predict(id, now) {
    this._age = 0;
    const result = this._predict(id, now);
    if (result[0] === AD) {
      // if the ad was triggered by a play, it began when that play was seen
      if (!this.adSince.has(id)) this.adSince.set(id, now - this._age);
    } else {
      this.adSince.delete(id);
    }
    return result;
  }

  // Seconds until the stream should come back from the current ad, or null if the feed
  // hasn't shown the ad ending yet. The feed is `delay` seconds ahead of the stream, so
  // replay the snapshots between the delayed view and now to find where the ad is over.
  returnIn(id, now) {
    if (this.predict(id, now)[0] !== AD) return null;
    const T = now - this.delay;
    const savedView = this.viewed.get(id), savedAge = this._age;
    let result = null;
    for (const [t] of this.hist(id)) {
      if (t > T && this._predict(id, t + this.delay)[0] !== AD) {
        result = Math.max(0, t + this.delay - now);
        break;
      }
    }
    if (savedView !== undefined) this.viewed.set(id, savedView);
    this._age = savedAge;
    return result;
  }

  // Seconds the game has been predicted to be in an ad, or null.
  adElapsed(id, now) {
    return this.adSince.has(id) ? Math.max(0, now - this.adSince.get(id)) : null;
  }

  // Seconds (as of T) the game clock has shown the same value.
  _clockFrozenFor(g, T) {
    const h = this.hist(g.id);
    let since = null;
    for (let i = h.length - 1; i >= 0; i--) {
      const [t, s] = h[i];
      if (t > T) continue;
      if (s.clock === g.clock && s.period === g.period) since = t;
      else break;
    }
    return since === null ? 0 : T - since;
  }

  // Did the feed go quiet for SOFT_CONFIRM_SECONDS after this play? Peeks at snapshots
  // newer than the delayed view, which the stream hasn't shown yet.
  _softAdConfirmed(g, now) {
    const first = this.firstSeen.get(key(g));
    for (const [t2, g2] of this.hist(g.id)) {
      if (t2 > first && g2.playId !== g.playId) return t2 - first >= SOFT_CONFIRM_SECONDS;
    }
    return now - first >= SOFT_CONFIRM_SECONDS;
  }

  _predict(id, now) {
    const hist = this.hist(id);
    if (hist.length === 0) return [UNKNOWN, "no data", null];
    const T = now - this.delay;
    let view = null;
    for (const [t, g] of hist) {
      if (t <= T) view = [t, g]; else break;
    }
    if (view === null) return [UNKNOWN, "warming up", null];
    const [t, g] = view;
    this.viewed.set(id, g);
    if (g.state === "pre") return [WAIT, "not started", null];
    if (g.state === "post") return [WAIT, "final", null];
    if (g.status === "STATUS_HALFTIME") return [AD, "halftime", null];
    if (g.clock === 0 && g.status === "STATUS_IN_PROGRESS" && (g.period === 1 || g.period === 3))
      return [AD, "end of quarter", null];
    const first = this.firstSeen.has(key(g)) ? this.firstSeen.get(key(g)) : t;
    const age = T - first;
    // Quarter break: ESPN flips the period and resets the clock to 15:00 while the
    // break is still on. It lasts until the next play shows up or the clock moves.
    if (isPeriodEnd(g.playType) && (g.clock === 0 || g.clock >= 899)) {
      this._age = age;
      return [AD, "quarter break", null];
    }
    const secs = classifyPlay(g.playType, g.playText);
    if ((g.period === 2 || g.period === 4) && g.clock === 120
        && this._clockFrozenFor(g, T) >= TWO_MIN_FROZEN_SECONDS) {
      this._age = this._clockFrozenFor(g, T);
      return [AD, "two-minute stoppage", null];
    }
    // a moving game clock means play resumed, even if the feed hasn't posted a new play
    const [period0, clock0] = this.firstClock.get(key(g)) || [g.period, g.clock];
    if (g.period !== period0 || Math.abs(g.clock - clock0) >= 1) return [LIVE, "clock running", null];
    const isInitial = this.initial.has(key(g));
    if (secs && !isInitial && SOFT_TRIGGERS.some((k) => g.playType.toLowerCase().includes(k))) {
      if (!this._softAdConfirmed(g, now)) return [LIVE, "no break confirmed", null];
      // a quiet feed confirmed the break: it lasts until the next play or the clock moves
      this._age = age;
      return [AD, `${g.playType} (${Math.trunc(age)}s ago)`, null];
    }
    if (secs && age < secs && !isInitial) {
      this._age = age;
      return [AD, `${g.playType} (${Math.trunc(age)}s ago)`, Math.trunc(secs - age)];
    }
    if (age > STALL_SECONDS) {
      this._age = age - STALL_SECONDS;
      return [AD, `no new play for ${Math.trunc(age)}s`, null];
    }
    return [LIVE, g.playType || "in play", null];
  }
}

// order: game ids in priority order. Returns the highest-priority LIVE game id.
export function pick(order, predictions) {
  for (const id of order) {
    const p = predictions.get(id);
    if (p && p[0] === LIVE) return id;
  }
  return null;
}
