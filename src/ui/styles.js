/** Shadow roots and slotted light-DOM controls use the same root stylesheet. */
export const stylesheetURL = new URL("../../styles.css", import.meta.url).href;
export const stylesheetLink = `<link rel="stylesheet" href="${stylesheetURL}">`;

export function ensureStyles(root) {
  if (!root?.querySelectorAll) return;
  const links = root.querySelectorAll('link[rel="stylesheet"]');
  if ([...links].some((link) => link.href === stylesheetURL)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = stylesheetURL;
  (root.head || root).append(link);
}

const pendingLinks = new WeakMap();

/** Measure only after the view and containing shadow roots have their external CSS. */
export function pendingStyles(element) {
  const roots = new Set();
  if (element.shadowRoot) roots.add(element.shadowRoot);
  let node = element;
  while (node?.getRootNode) {
    const root = node.getRootNode();
    roots.add(root);
    node = root.host;
  }
  const waiting = [];
  for (const root of roots) {
    for (const link of root.querySelectorAll?.('link[rel="stylesheet"]') ||
      []) {
      if (link.href !== stylesheetURL || link.sheet) continue;
      let state = pendingLinks.get(link);
      if (!state) {
        state = { settled: false };
        state.promise = new Promise((resolve) => {
          const finish = () => {
            state.settled = true;
            link.removeEventListener("load", finish);
            link.removeEventListener("error", finish);
            resolve();
          };
          link.addEventListener("load", finish);
          link.addEventListener("error", finish);
        });
        pendingLinks.set(link, state);
      }
      if (!state.settled) waiting.push(state.promise);
    }
  }
  return waiting.length ? Promise.all(waiting) : null;
}
