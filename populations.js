/** Point populations choose marks; providers remain independent and freely mixable. */
export const populations = ['bytes', 'pairs', 'triples', 'bins'];
export const defaultSampleLimit = 262144;

// A tuple uses its first occurrence in the selection for offset-based analyses.
// Keep this relationship explicit and stable rather than assigning an arbitrary
// synthetic byte address to an aggregated point.
export function populationOffsets(job, bytes, cache) {
 const population = job.configuration.population || 'bytes';
 if (population === 'bytes' || population === 'bins') return null;
 const source = job.sourceId ?? job.source;
 const key = `${job.offset}/${job.length}/${population}`;
 if (cache.population?.source === source && cache.population.key === key) return cache.population.offsets;
 const width = population === 'pairs' ? 2 : 3;
 const first = new Map();
 let tuple = 0;
 const mask = width === 2 ? 0xffff : 0xffffff;
 for (let i = 0; i < bytes.length; i++) {
  tuple = ((tuple << 8) | bytes[i]) & mask;
  if (i >= width - 1 && !first.has(tuple)) first.set(tuple, i - width + 1);
 }
 const offsets = Float64Array.from(first.values());
 cache.population = { source, key, offsets };
 return offsets;
}

export function limitedSampleLayout(layout, configuration) {
 const limit = configuration.sampleLimit === null ? Infinity : configuration.sampleLimit ?? defaultSampleLimit;
 if (layout.columns * layout.rows <= limit) return layout;
 if (configuration.layout === 'hilbert') {
  const side = 2 ** Math.max(0, Math.floor(Math.log2(Math.sqrt(limit))));
  return { ...layout, columns: side, rows: side };
 }
 const columns = Math.max(1, Math.min(limit, Math.round(Math.sqrt(limit * layout.columns / layout.rows))));
 return { ...layout, columns, rows: Math.max(1, Math.floor(limit / columns)) };
}
