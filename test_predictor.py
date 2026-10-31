from espn import Game
from predictor import Predictor, pick, LIVE, AD


def g(play_id, ptype, clock=500, period=2, status="STATUS_IN_PROGRESS", state="in", text=""):
    return Game("1", "A @ B", state, status, "", clock, period, [("A", "A U", "A", "A"), ("B", "B U", "B", "B")],
                play_id, ptype, text, "")


def run(events, at, delay=0):
    p = Predictor(delay=delay)
    for t, game in events:
        p.observe([game], t)
    return p.predict("1", at)[0]


def test_live_play():
    assert run([(0, g("a", "Rush"))], 5) == LIVE

def test_ad_after_touchdown_then_ends():
    ev = [(0, g("a", "Rush")), (10, g("b", "Rushing Touchdown")), (60, g("c", "Kickoff"))]
    assert run(ev[:2], 40) == AD
    assert run(ev, 62) == LIVE

def test_delay_shifts_view():
    ev = [(0, g("a", "Rush")), (10, g("b", "Timeout"))]
    assert run(ev, 20, delay=15) == LIVE   # stream hasn't reached the timeout yet
    assert run(ev, 30, delay=15) == AD

def test_stall_is_ad():
    ev = [(0, g("a", "Rush")), (100, g("a", "Rush"))]
    assert run(ev, 100) == AD

def test_halftime():
    assert run([(0, g("a", "End Period", status="STATUS_HALFTIME"))], 1) == AD

def test_pick_priority():
    assert pick(["1", "2", "3"], {"1": (AD,), "2": (LIVE,), "3": (LIVE,)}) == "2"
    assert pick(["1"], {"1": (AD,)}) is None

def test_clock_moving_ends_review_ad():
    ev = [(0, g("a", "Rush")), (10, g("b", "Pass Reception", clock=500, text="under review")),
          (40, g("b", "Pass Reception", clock=500, text="under review")),
          (50, g("b", "Pass Reception", clock=490, text="under review"))]
    assert run(ev[:3], 41) == AD
    assert run(ev, 51) == LIVE

def test_quarter_break_survives_period_flip():
    ev = [(0, g("a", "Rush", clock=30, period=3)),
          (10, g("b", "End Period", clock=0, period=3)),
          (20, g("b", "End Period", clock=900, period=4)),
          (200, g("b", "End Period", clock=900, period=4))]
    assert run(ev, 21) == AD
    assert run(ev, 201) == AD                     # no timer expiry mid-break
    ev.append((210, g("c", "Kickoff", clock=900, period=4)))
    assert run(ev, 211) == LIVE

def test_turnover_followed_quickly_is_not_an_ad():
    ev = [(0, g("a", "Rush")), (10, g("b", "Interception")), (40, g("c", "Rush"))]
    assert run(ev, 12) == LIVE   # not confirmed yet
    assert run(ev, 41) == LIVE   # next play came 30s later: no break

def test_turnover_with_long_gap_is_an_ad():
    ev = [(0, g("a", "Rush")), (10, g("b", "Punt"))]
    assert run(ev, 30) == LIVE
    assert run(ev, 60) == AD

def test_confirmed_punt_ad_does_not_expire_before_stall():
    ev = [(0, g("a", "Rush")), (10, g("b", "Punt"))]
    assert run(ev, 60) == AD
    assert run(ev, 85) == AD    # past the 60s expiry, still quiet

def test_two_minute_stoppage():
    ev = [(0, g("a", "Rush", clock=140, period=4)),
          (10, g("b", "Rush", clock=120, period=4)),
          (14, g("b", "Rush", clock=120, period=4)),
          (30, g("b", "Rush", clock=120, period=4))]
    assert run(ev[:2], 12) == LIVE      # clock just parked at 2:00
    assert run(ev, 31) == AD
    ev.append((40, g("c", "Rush", clock=112, period=4)))
    assert run(ev, 41) == LIVE

def test_two_minute_ignored_in_other_quarters():
    ev = [(0, g("a", "Rush", clock=120, period=3)), (30, g("a", "Rush", clock=120, period=3))]
    assert run(ev, 31) == LIVE

def test_return_countdown_uses_lookahead():
    ev = [(0, g("a", "Rush", clock=500)), (10, g("b", "Timeout", clock=500)),
          (50, g("c", "Rush", clock=495))]
    p = Predictor(delay=30)
    for tt, game in ev:
        p.observe([game], tt)
    assert p.predict("1", 55)[0] == AD       # stream still on the ad
    assert p.return_in("1", 55) == 25        # feed shows play at t=50; stream gets it at t=80
    p2 = Predictor(delay=30)
    for tt, game in ev[:2]:
        p2.observe([game], tt)
    assert p2.predict("1", 45)[0] == AD
    assert p2.return_in("1", 45) is None     # feed hasn't shown the ad ending yet

def test_overtime_break_survives_period_change():
    ev = [(0, g("a", "Rush", clock=20, period=4)),
          (10, g("b", "End of Regulation", clock=0, period=4)),
          (20, g("b", "End of Regulation", clock=0, period=5)),
          (300, g("b", "End of Regulation", clock=0, period=5))]
    assert run(ev, 21) == AD
    assert run(ev, 301) == AD
    ev.append((310, g("c", "Rush", clock=0, period=5)))
    assert run(ev, 311) == LIVE
