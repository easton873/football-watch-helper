"""Predict whether a game is currently in a commercial break.

Each poll we record, per game, a snapshot of the latest play. Because the TV stream
runs behind ESPN's feed, we judge the game as it looked `delay` seconds ago.

Rules (tune in AD_RULES / STALL_SECONDS using the log files):
  * halftime / end of period -> ad
  * certain plays (score, timeout, punt, turnover, review) start an ad that is
    expected to last N seconds, or until the next play shows up in the feed
  * no new play for STALL_SECONDS while the game is live -> probably an ad/review
"""
from collections import defaultdict, deque

# (keyword in play type or text, expected ad seconds). First match wins.
AD_RULES = [
    ("timeout", 120),
    ("end period", 120),
    ("end of", 120),
    ("review", 120),
    ("touchdown", 100),
    ("field goal good", 100),
    ("safety", 100),
    ("extra point", 60),
    ("punt", 60),
    ("interception", 75),
    ("fumble recovery (opponent)", 75),
    ("field goal missed", 60),
]
STALL_SECONDS = 90
# Turnovers, punts and missed FGs usually go straight to the next snap. Only call an ad
# if the feed takes at least this long (real seconds) to post the next play.
SOFT_TRIGGERS = ("interception", "fumble recovery", "punt", "field goal missed")
SOFT_CONFIRM_SECONDS = 45
# Two-minute stoppage: ESPN parks the clock at exactly 2:00 in the 2nd/4th quarter.
TWO_MIN_FROZEN_SECONDS = 8

LIVE, AD, WAIT, UNKNOWN = "LIVE", "AD", "WAIT", "UNKNOWN"


def is_period_end(play_type):
    """End Period, End of Regulation, End of Half... but not End of Game."""
    t = play_type.lower()
    return (t == "end period" or t.startswith("end of")) and "game" not in t


def classify_play(play_type, play_text):
    t = play_type.lower()
    for kw, secs in AD_RULES:
        if kw in t:
            return secs
    # fall back to text only for reviews/timeouts, which can hide in other play types
    x = play_text.lower()
    if "timeout" in x or "under review" in x or "official review" in x:
        return 90
    return 0


class Predictor:
    def __init__(self, delay=30.0):
        self.delay = delay
        self.history = defaultdict(lambda: deque(maxlen=2000))  # id -> (t, Game)
        self.first_seen = {}                                     # (id, play_id) -> t
        self.viewed = {}                                         # id -> Game as of the delayed view
        self.ad_since = {}                                       # id -> wall time ad began
        self._age = 0
        self.first_clock = {}                                    # (id, play_id) -> (period, clock)
        self.initial = set()                                     # plays already live at startup

    def observe(self, games, now):
        for g in games:
            if not self.history[g.id]:
                # play was already underway when we started; its true age is unknown
                self.initial.add((g.id, g.play_id))
            self.history[g.id].append((now, g))
            if (g.id, g.play_id) not in self.first_seen:
                self.first_clock[(g.id, g.play_id)] = (g.period, g.clock)
            self.first_seen.setdefault((g.id, g.play_id), now)

    def predict(self, game_id, now):
        """Return (state, reason, seconds_left_in_ad_or_None)."""
        self._age = 0
        result = self._predict(game_id, now)
        if result[0] == AD:
            # if the ad was triggered by a play, it began when that play was seen
            self.ad_since.setdefault(game_id, now - self._age)
        else:
            self.ad_since.pop(game_id, None)
        return result

    def return_in(self, game_id, now):
        """Seconds until the stream should come back from the current ad, or None if the
        feed hasn't shown the ad ending yet. The feed is `delay` seconds ahead of the stream,
        so replay the snapshots between the delayed view and now to find the first one where
        the ad is over."""
        if self.predict(game_id, now)[0] != AD:
            return None
        T = now - self.delay
        saved = (self.viewed.get(game_id), self._age)
        result = None
        for t, _ in self.history[game_id]:
            if t > T and self._predict(game_id, t + self.delay)[0] != AD:
                result = max(0, t + self.delay - now)
                break
        if saved[0] is not None:
            self.viewed[game_id] = saved[0]
        self._age = saved[1]
        return result

    def ad_elapsed(self, game_id, now):
        """Seconds the game has been predicted to be in an ad, or None."""
        since = self.ad_since.get(game_id)
        return None if since is None else max(0, now - since)

    def _clock_frozen_for(self, g, T):
        """Seconds (as of T) the game clock has shown the same value."""
        since = None
        for t, h in reversed(self.history[g.id]):
            if t > T:
                continue
            if h.clock == g.clock and h.period == g.period:
                since = t
            else:
                break
        return 0 if since is None else T - since

    def _soft_ad_confirmed(self, g, now):
        """Did the feed go quiet for SOFT_CONFIRM_SECONDS after this play? Peeks at snapshots
        newer than the delayed view, which the stream hasn't shown yet."""
        first = self.first_seen[(g.id, g.play_id)]
        for t2, g2 in self.history[g.id]:
            if t2 > first and g2.play_id != g.play_id:
                return t2 - first >= SOFT_CONFIRM_SECONDS
        return now - first >= SOFT_CONFIRM_SECONDS

    def _predict(self, game_id, now):
        hist = self.history[game_id]
        if not hist:
            return UNKNOWN, "no data", None
        T = now - self.delay
        view = None
        for t, g in hist:
            if t <= T:
                view = (t, g)
            else:
                break
        if view is None:
            return UNKNOWN, "warming up", None
        t, g = view
        self.viewed[game_id] = g
        if g.state == "pre":
            return WAIT, "not started", None
        if g.state == "post":
            return WAIT, "final", None
        if g.status == "STATUS_HALFTIME":
            return AD, "halftime", None
        if g.clock == 0 and g.status == "STATUS_IN_PROGRESS" and g.period in (1, 3):
            return AD, "end of quarter", None
        first = self.first_seen.get((g.id, g.play_id), t)
        age = T - first
        # Quarter break: ESPN flips the period and resets the clock to 15:00 while the
        # break is still on. It lasts until the next play shows up or the clock moves.
        if is_period_end(g.play_type) and (g.clock == 0 or g.clock >= 899):
            self._age = age
            return AD, "quarter break", None
        secs = classify_play(g.play_type, g.play_text)
        if g.period in (2, 4) and g.clock == 120 and self._clock_frozen_for(g, T) >= TWO_MIN_FROZEN_SECONDS:
            self._age = self._clock_frozen_for(g, T)
            return AD, "two-minute stoppage", None
        # a moving game clock means play resumed, even if the feed hasn't posted a new play
        period0, clock0 = self.first_clock.get((g.id, g.play_id), (g.period, g.clock))
        resumed = g.period != period0 or abs(g.clock - clock0) >= 1
        if resumed:
            return LIVE, "clock running", None
        if secs and (g.id, g.play_id) not in self.initial and any(
                k in g.play_type.lower() for k in SOFT_TRIGGERS):
            if not self._soft_ad_confirmed(g, now):
                return LIVE, "no break confirmed", None
            # a quiet feed confirmed the break: it lasts until the next play or the clock moves
            self._age = age
            return AD, f"{g.play_type} ({int(age)}s ago)", None
        if secs and age < secs and (g.id, g.play_id) not in self.initial:
            self._age = age
            return AD, f"{g.play_type} ({int(age)}s ago)", int(secs - age)
        if age > STALL_SECONDS:
            self._age = age - STALL_SECONDS
            return AD, f"no new play for {int(age)}s", None
        return LIVE, g.play_type or "in play", None


def pick(order, predictions):
    """order: game ids in priority order. Returns the highest-priority LIVE game id."""
    for gid in order:
        if predictions.get(gid, (UNKNOWN,))[0] == LIVE:
            return gid
    return None
