/** Read-only analysis belongs to the immutable source; raster/selection mutation stays per view. */
const sources = new WeakMap();
export function sharedAnalysisFor(source) {
  let state = sources.get(source);
  if (!state) {
    state = { spectra: new Map(), spectrumBytes: 0 };
    sources.set(source, state);
  }
  return state;
}
