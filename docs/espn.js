// Fetch live college football game state from ESPN's unofficial scoreboard API.
// ESPN sends access-control-allow-origin: *, so the browser can call it directly.
const URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300";

export function parse(data) {
  return (data.events || []).map((e) => {
    const c = e.competitions[0];
    const st = e.status;
    const play = (c.situation && c.situation.lastPlay) || {};
    return {
      id: e.id,
      name: e.shortName || e.id,          // e.g. "ORE @ ILL"
      state: st.type.state,               // pre | in | post
      status: st.type.name,               // e.g. STATUS_HALFTIME
      detail: st.type.shortDetail || "",  // e.g. "9:47 - 4th"
      clock: Number(st.clock || 0),
      period: Number(st.period || 0),
      // [abbr, displayName, location, shortDisplayName]
      teams: (c.competitors || []).map((t) => [
        t.team.abbreviation || "", t.team.displayName || "",
        t.team.location || "", t.team.shortDisplayName || ""]),
      playId: String(play.id || ""),
      playType: (play.type && play.type.text) || "",
      playText: play.text || "",
      channel: (c.broadcasts || []).filter((b) => b.names && b.names.length).map((b) => b.names[0]).join(", "),
      start: e.date || "",
    };
  });
}

export async function fetchGames() {
  const r = await fetch(URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parse(await r.json());
}

// Does a priority entry (abbreviation or school name, any case) match this game?
export function matches(entry, game) {
  const e = entry.trim().toLowerCase();
  return game.teams.some((names) => names.some((n) => n.toLowerCase() === e));
}

// [{entry, game}] in priority order, each game once at its best-ranked slot.
export function orderGames(priorities, games) {
  const out = [], seen = new Set();
  for (const entry of priorities) {
    for (const g of games) {
      if (!seen.has(g.id) && matches(entry, g)) { out.push({ entry, game: g }); seen.add(g.id); }
    }
  }
  return out;
}

// "1st".."4th", "OT", "2OT"... No game clock, on purpose.
export function periodLabel(g) {
  if (g.state === "pre") return "Upcoming";
  if (g.state === "post") return "Final";
  const p = g.period;
  if (p >= 5) return p === 5 ? "OT" : `${p - 4}OT`;
  return ["", "1st", "2nd", "3rd", "4th"][p] || "Live";
}
