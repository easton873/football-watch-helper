"""Ad-break tracker: ranks your college games and says which to watch right now.

  python3 main.py --list        show today's games
  python3 main.py               run with priorities.json
"""
import argparse
import json
import os
import time

import espn
from predictor import Predictor, pick, LIVE, AD

SHORT_AD_SECONDS = 30

COLORS = {"WATCH": "\033[1;32m", "LIVE": "\033[32m", "AD": "\033[31m", "WAIT": "\033[90m", "UNKNOWN": "\033[33m"}
RESET = "\033[0m"


def match(entry, game):
    e = entry.lower()
    for names in game.teams:
        if e in (n.lower() for n in names):
            return True
    return False


def order_games(priorities, games):
    """Game ids in priority order (each game once, at its best-ranked slot)."""
    ordered, seen = [], set()
    for entry in priorities:
        for g in games:
            if g.id not in seen and match(entry, g):
                ordered.append((entry, g))
                seen.add(g.id)
    return ordered


def list_games(games):
    for g in games:
        print(f"{g.state:4} {g.name:14} {g.detail:18} {g.channel}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--config", default="priorities.json")
    ap.add_argument("--delay", type=float, help="seconds the TV stream lags ESPN")
    args = ap.parse_args()

    if args.list:
        list_games(espn.fetch())
        return

    cfg = json.load(open(args.config))
    pred = Predictor(delay=args.delay if args.delay is not None else cfg["delay_seconds"])
    os.makedirs("logs", exist_ok=True)
    log = open(f"logs/{time.strftime('%Y%m%d-%H%M%S')}.jsonl", "a")
    short_log = open(f"logs/short_ads-{time.strftime('%Y%m%d-%H%M%S')}.jsonl", "a")
    last = {}
    open_ads = {}   # game id -> info about the ad currently in progress

    while True:
        now = time.time()
        try:
            games = espn.fetch()
        except Exception as ex:
            print(f"fetch failed: {ex}")
            time.sleep(cfg["poll_seconds"])
            continue
        pred.observe(games, now)
        ranked = order_games(cfg["priorities"], games)
        preds = {g.id: pred.predict(g.id, now) for _, g in ranked}
        for _, g in ranked:
            state, reason, _left = preds[g.id]
            el = pred.ad_elapsed(g.id, now)
            if state == AD and el is not None:
                info = open_ads.setdefault(g.id, {
                    "game": g.name, "started": now - el, "start_reason": reason,
                    "start_detail": g.detail, "play_type": g.play_type,
                    "play": g.play_text[:200]})
                info["elapsed"] = el
            elif g.id in open_ads:
                info = open_ads.pop(g.id)
                if info["elapsed"] < SHORT_AD_SECONDS:
                    info.update(ended=now, end_state=state, end_reason=reason,
                                end_detail=g.detail, end_play_type=g.play_type,
                                end_play=g.play_text[:200])
                    short_log.write(json.dumps(info) + "\n")
                    short_log.flush()
        best = pick([g.id for _, g in ranked], preds)

        lines = [f"last polled {time.strftime('%H:%M:%S', time.localtime(now))}  "
                 f"(delay {pred.delay:.0f}s)", "",
                 f"   {'GAME':14} {'CLOCK':16} {'STATUS':7} {'IN AD':>6}  {'RETURN':>6}"]
        for i, (entry, g) in enumerate(ranked, 1):
            state, reason, left = preds[g.id]
            label = "WATCH" if g.id == best else state
            el = pred.ad_elapsed(g.id, now)
            in_ad = f"{int(el)}s" if el is not None else "-"
            if state == AD:
                ret = pred.return_in(g.id, now)
                back = f"{int(ret + 0.5)}s" if ret is not None else f"{pred.delay:.0f}+"
            else:
                back = "-"
            shown = pred.viewed.get(g.id, g)   # same moment the status is judged from
            lines.append(f"{i}. {g.name:14} {shown.detail:16} "
                         f"{COLORS[label]}{label:7}{RESET} {in_ad:>6}  {back:>6}")
            if last.get(g.id) != (g.play_id, state):
                last[g.id] = (g.play_id, state)
                log.write(json.dumps({"t": now, "game": g.name, "state": state,
                                      "reason": reason, "detail": g.detail,
                                      "play_id": g.play_id, "play_type": g.play_type,
                                      "play": g.play_text[:200]}) + "\n")
                log.flush()
        if not ranked:
            lines.append("none of your priorities matched a game today (try --list)")
        elif best is None:
            lines.append("\nAll your games are in ads or not live.")
        else:
            lines.append(f"\nSwitch to: {next(g.name for _, g in ranked if g.id == best)}")
        print("\033[2J\033[H" + "\n".join(lines), flush=True)
        time.sleep(cfg["poll_seconds"])


if __name__ == "__main__":
    main()
