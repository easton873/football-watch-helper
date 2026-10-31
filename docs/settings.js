import { load, save } from "./store.js";
import { el, nav } from "./ui.js";

nav("settings.html");
const $ = (id) => document.getElementById(id);
const s = load();

function persist() {
  $("saved").textContent = save(s) ? "Saved." : "Couldn't save: this browser is blocking site storage.";
}

function renderList() {
  const ol = $("prio");
  ol.replaceChildren();
  if (!s.priorities.length) ol.append(el("li", {}, el("span", { class: "grow empty" }, "No teams yet.")));
  s.priorities.forEach((name, i) => {
    const move = (d) => { const j = i + d; [s.priorities[i], s.priorities[j]] = [s.priorities[j], s.priorities[i]]; persist(); renderList(); };
    ol.append(el("li", {},
      el("span", { class: "rank" }, String(i + 1)),
      el("span", { class: "grow" }, name),
      el("button", { class: "icon", type: "button", "aria-label": `Move ${name} up`, disabled: i === 0, onclick: () => move(-1) }, "↑"),
      el("button", { class: "icon", type: "button", "aria-label": `Move ${name} down`, disabled: i === s.priorities.length - 1, onclick: () => move(1) }, "↓"),
      el("button", { class: "icon", type: "button", "aria-label": `Remove ${name}`, onclick: () => { s.priorities.splice(i, 1); persist(); renderList(); } }, "✕")));
  });
}

function add() {
  const v = $("add").value.trim();
  if (!v || s.priorities.some((p) => p.toLowerCase() === v.toLowerCase())) { $("add").value = ""; return; }
  s.priorities.push(v);
  $("add").value = "";
  persist(); renderList();
}

$("addbtn").addEventListener("click", add);
$("add").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
$("delay").value = s.delay; $("delayout").textContent = s.delay;
$("delay").addEventListener("input", (e) => { s.delay = Number(e.target.value); $("delayout").textContent = s.delay; persist(); });
$("poll").value = String(s.poll);
$("poll").addEventListener("change", (e) => { s.poll = Number(e.target.value); persist(); });
renderList();
