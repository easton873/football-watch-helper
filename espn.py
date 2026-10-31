"""Fetch live college football game state from ESPN's unofficial scoreboard API."""
import json
import urllib.request
from dataclasses import dataclass

URL = ("https://site.api.espn.com/apis/site/v2/sports/football/"
       "college-football/scoreboard?groups=80&limit=300")


@dataclass
class Game:
    id: str
    name: str            # e.g. "ORE @ ILL"
    state: str           # pre | in | post
    status: str          # ESPN status name, e.g. STATUS_HALFTIME
    detail: str          # e.g. "9:47 - 4th"
    clock: float
    period: int
    teams: list          # [(abbr, displayName, location, shortDisplayName), ...]
    play_id: str
    play_type: str
    play_text: str
    channel: str


def parse(data):
    games = []
    for e in data.get("events", []):
        c = e["competitions"][0]
        st = e["status"]
        play = (c.get("situation") or {}).get("lastPlay") or {}
        games.append(Game(
            id=e["id"],
            name=e.get("shortName", e["id"]),
            state=st["type"]["state"],
            status=st["type"]["name"],
            detail=st["type"].get("shortDetail", ""),
            clock=float(st.get("clock") or 0),
            period=int(st.get("period") or 0),
            teams=[(t["team"].get("abbreviation", ""), t["team"].get("displayName", ""),
                    t["team"].get("location", ""), t["team"].get("shortDisplayName", ""))
                   for t in c.get("competitors", [])],
            play_id=str(play.get("id", "")),
            play_type=(play.get("type") or {}).get("text", ""),
            play_text=play.get("text", ""),
            channel=", ".join(b.get("names", [""])[0] for b in c.get("broadcasts", [])
                              if b.get("names")),
        ))
    return games


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return parse(json.load(r))
