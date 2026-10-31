import { Predictor, pick, AD } from "./predictor.js";
import { fetchGames, orderGames, periodLabel } from "./espn.js";
import { load } from "./store.js";
import { el, nav } from "./ui.js";

nav("index.html");
const $ = (id) => document.getElementById(id);

let settings = load();
const pred = new Predictor(settings.delay);
let games = [];
let lastPolled = null, lastError = null, errors = 0;

function render() {
  const now = Date.now() / 1000;
  settings = load();
  pred.delay = settings.delay;
  const ranked = orderGames(settings.priorities, games);
  const preds = new Map(ranked.map(({ game }) => [game.id, pred.predict(game.id, now)]));
  const best = pick(ranked.map((r) => r.game.id), preds);

  const rows = $("rows");
  rows.replaceChildren();
  ranked.forEach(({ game: g }, i) => {
    const [state] = preds.get(g.id);
    const label = g.id === best ? "WATCH" : state;
    const elapsed = pred.adElapsed(g.id, now);
    let back = "–";
    if (state === AD) {
      const r = pred.returnIn(g.id, now);
      back = r !== null ? `${Math.round(r)}s` : `${Math.round(pred.delay)}+`;
    }
    const shown = pred.viewed.get(g.id) || g;  // same moment the status is judged from
    rows.append(el("tr", {},
      el("td", {}, String(i + 1)),
      el("td", {}, g.name),
      el("td", {}, periodLabel(shown)),
      el("td", {}, el("span", { class: `pill ${label}` }, label)),
      el("td", { class: "num" }, elapsed !== null && state === AD ? `${Math.floor(elapsed)}s` : "–"),
      el("td", { class: "num" }, back)));
  });

  const empty = $("empty");
  empty.replaceChildren();
  if (!settings.priorities.length) {
    empty.append(el("div", { class: "empty" }, "No teams yet. Pick some on the ", el("a", { href: "games.html" }, "Games"), " page."));
  } else if (!ranked.length && lastPolled) {
    empty.append(el("div", { class: "empty" }, "None of your teams are playing today. Check the ", el("a", { href: "games.html" }, "Games"), " page."));
  }

  const banner = $("banner");
  banner.replaceChildren();
  if (document.visibilityState === "hidden") banner.append(el("div", { class: "card banner warn" }, "This tab is in the background, so polling may be throttled and predictions can be wrong."));
  if (lastError) banner.append(el("div", { class: "card banner warn" }, `Couldn't reach ESPN (${lastError}). Retrying…`));
  if (ranked.length) {
    if (best) {
      const g = ranked.find((r) => r.game.id === best).game;
      banner.append(el("div", { class: "card banner go" }, `Switch to: ${g.name}`));
      document.title = `→ ${g.name}`;
    } else {
      banner.append(el("div", { class: "card banner" }, "All your games are in ads or not live.", el("small", {}, "Stay on whatever you're watching.")));
      document.title = "Ad Break Tracker";
    }
  }
  $("polled").textContent = lastPolled ? `Last polled ${new Date(lastPolled * 1000).toLocaleTimeString()}` : "Starting…";
  $("delaynote").textContent = `Stream delay ${Math.round(pred.delay)}s`;
}

async function poll() {
  try {
    games = await fetchGames();
    pred.observe(games, Date.now() / 1000);
    lastPolled = Date.now() / 1000; lastError = null; errors = 0;
  } catch (e) { lastError = e.message; errors++; }
  render();
  // back off exponentially while ESPN is failing (max 16x)
  setTimeout(poll, load().poll * 1000 * 2 ** Math.min(errors, 4));
}

let wakeLock = null;
$("wake").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  if (wakeLock) { await wakeLock.release(); wakeLock = null; btn.setAttribute("aria-pressed", "false"); return; }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; btn.setAttribute("aria-pressed", "false"); });
    btn.setAttribute("aria-pressed", "true");
  } catch { btn.textContent = "Keep awake unavailable"; btn.disabled = true; }
});
document.addEventListener("visibilitychange", () => render());

poll();
setInterval(render, 1000);
