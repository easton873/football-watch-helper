import { fetchGames, periodLabel } from "./espn.js";
import { load, save } from "./store.js";
import { el, nav } from "./ui.js";

nav("games.html");
const $ = (id) => document.getElementById(id);
let games = [];
let settings = load();

const isOn = (abbr) => settings.priorities.some((p) => p.toLowerCase() === abbr.toLowerCase());

function toggle(abbr) {
  settings = load();
  if (isOn(abbr)) settings.priorities = settings.priorities.filter((p) => p.toLowerCase() !== abbr.toLowerCase());
  else settings.priorities.push(abbr);
  save(settings);
  render();
}

function whenText(g) {
  if (g.state !== "pre") return periodLabel(g);
  const d = new Date(g.start);
  return isNaN(d) ? g.detail : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function section(title, list, container) {
  if (!list.length) return;
  container.append(el("div", { class: "section" }, `${title} (${list.length})`));
  const card = el("div", { class: "card" });
  for (const g of list) {
    const teams = el("div", { class: "teams" });
    g.teams.forEach(([abbr, name]) => {
      teams.append(el("button", { class: "chip", type: "button", "aria-pressed": String(isOn(abbr)), title: name, onclick: () => toggle(abbr) },
        abbr || name));
    });
    card.append(el("div", { class: "game" }, el("span", { class: "when" }, whenText(g)), teams, el("span", { class: "chan" }, g.channel)));
  }
  container.append(card);
}

function render() {
  settings = load();
  const q = $("q").value.trim().toLowerCase();
  const shown = games.filter((g) => !q || g.channel.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)
    || g.teams.some((t) => t.some((n) => n.toLowerCase().includes(q))));
  const byStart = (a, b) => a.start.localeCompare(b.start);
  const list = $("list");
  list.replaceChildren();
  section("Live", shown.filter((g) => g.state === "in").sort(byStart), list);
  section("Upcoming", shown.filter((g) => g.state === "pre").sort(byStart), list);
  section("Final", shown.filter((g) => g.state === "post").sort(byStart), list);
  if (!shown.length && games.length) list.append(el("div", { class: "empty" }, "No games match that filter."));
}

async function refresh() {
  $("status").textContent = "Loading…";
  try {
    games = await fetchGames();
    $("status").textContent = `${games.length} games · updated ${new Date().toLocaleTimeString()} · ${settings.priorities.length} picked`;
  } catch (e) { $("status").textContent = `Couldn't reach ESPN (${e.message}).`; }
  render();
}

$("q").addEventListener("input", render);
$("refresh").addEventListener("click", refresh);
refresh();
