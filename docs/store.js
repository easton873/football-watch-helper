// Settings live in localStorage (there is no server). Every access is wrapped because
// storage can be blocked or empty (private windows, cleared site data).
const KEY = "adtracker.settings.v1";
const DEFAULTS = { priorities: [], delay: 30, poll: 5 };

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      priorities: Array.isArray(s.priorities) ? s.priorities.filter((x) => typeof x === "string") : DEFAULTS.priorities,
      delay: Number.isFinite(s.delay) ? s.delay : DEFAULTS.delay,
      poll: Number.isFinite(s.poll) ? s.poll : DEFAULTS.poll,
    };
  } catch { return { ...DEFAULTS, priorities: [] }; }
}

export function save(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); return true; }
  catch { return false; }
}
