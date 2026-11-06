import { DataScroll } from "./main.js";

/**
 * Load the fragment URL through HTTP and keep the previous source on failed fetches. Initial import
 * registers elements; only DOMContentLoaded mounts the default full-screen instance.
 */
function onDOMContentLoaded() {
  const scroll = new DataScroll();
  document.body.append(scroll);
  let pending;
  /**
   * Abort superseded fetches before replacing the root Blob, so a slow response cannot overwrite a
   * newer fragment selection.
   */
  async function load() {
    pending?.abort();
    const request = (pending = new AbortController());
    try {
      const path = location.hash.slice(1) || "./examples/cat";
      const response = await fetch(new URL(path, document.baseURI), {
        signal: request.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = await response.blob();
      if (!request.signal.aborted) scroll.source = source;
    } catch (error) {
      if (!request.signal.aborted)
        console.error("Unable to load binary data:", error);
    }
  }
  window.addEventListener("hashchange", load);
  return load();
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", onDOMContentLoaded, {
    once: true,
  });
else onDOMContentLoaded();
