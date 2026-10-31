// Tiny DOM helpers shared by the pages. ESPN text is only ever set via textContent.
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) e.append(kid instanceof Node ? kid : document.createTextNode(kid ?? ""));
  return e;
}

export function nav(current) {
  const links = [["index.html", "Tracker"], ["games.html", "Games"], ["settings.html", "Settings"]];
  const n = el("nav", { "aria-label": "Pages" });
  for (const [href, label] of links) {
    const a = el("a", { href }, label);
    if (href === current) a.setAttribute("aria-current", "page");
    n.append(a);
  }
  document.body.prepend(n);
}
