/** Optional developer measurements. Never inspect source bytes or time individual points. */
export function createProviderDiagnostics(job) {
  if (job.diagnostics !== true) return undefined;
  return {
    source: { reads: 0, bytes: 0, milliseconds: 0 },
    providers: {},
    evaluation: { milliseconds: 0, samples: 0 },
    preparationReused: false,
  };
}

/** Provider durations include their own reads; do not sum them with read time. */
export function recordProvider(diagnostics, name, started, rebuilt) {
  if (!diagnostics) return;
  const metric = (diagnostics.providers[name] ||= {
    milliseconds: 0,
    rebuilds: 0,
    hits: 0,
  });
  metric.milliseconds += performance.now() - started;
  metric[rebuilt ? "rebuilds" : "hits"]++;
}

/** The Blob remains the source and cache identity; only the read operation is measured. */
export async function readProviderBytes(source, start, end, diagnostics) {
  const started = diagnostics ? performance.now() : 0;
  const bytes = new Uint8Array(await source.slice(start, end).arrayBuffer());
  if (diagnostics) {
    diagnostics.source.reads++;
    diagnostics.source.bytes += bytes.byteLength;
    diagnostics.source.milliseconds += performance.now() - started;
  }
  return bytes;
}

/**
 * Count retained provider ArrayBuffer storage exactly, including backing storage of subarrays.
 * Excludes object/Map overhead, prepared marks, raster/GPU storage and transient FFT work.
 */
export function retainedProviderStorage(cache) {
  const views = new Set(),
    buffers = new Set(),
    maps = new Set();
  const add = (value) => {
    if (ArrayBuffer.isView(value)) {
      views.add(value);
      buffers.add(value.buffer);
    } else if (value instanceof Map) maps.add(value);
  };
  add(cache.factorWindow?.data);
  add(cache.factorEntropy?.values);
  const entropyWindows = cache.recipeEntropy?.values;
  add(entropyWindows);
  if (entropyWindows) for (const values of entropyWindows.values()) add(values);
  for (const name of ["byteHistogram", "pairHistogram", "trigraph"])
    add(cache[name]?.counts);
  for (const value of Object.values(cache.factorCounts || {})) add(value);
  for (const value of Object.values(cache.factorSpectrum || {})) add(value);
  add(cache.population?.offsets);
  add(cache.population?.keys);
  add(cache.population?.counts);
  for (const range of cache.factorSparse?.ranges || []) add(range.data);
  for (const values of cache.factorSparse?.entropyValues?.values() || [])
    add(values);
  add(cache.analysisProviders?.conditional?.joint);
  add(cache.analysisProviders?.conditional?.rows);
  for (const group of cache.analysisProviders?.groups?.values() || []) {
    add(group.results);
    add(group.reference?.negativeLogProbabilities);
  }
  for (const model of cache.analysisProviders?.occurrences?.values() || []) {
    add(model.counts);
    add(model.sorted);
  }
  for (const model of cache.analysisProviders?.reductions?.values() || []) {
    add(model.counts);
    add(model.sums);
  }
  return {
    typedArrayBytes: [...buffers].reduce(
      (sum, buffer) => sum + buffer.byteLength,
      0,
    ),
    buffers: buffers.size,
    views: views.size,
    mapEntries: [...maps].reduce((sum, map) => sum + map.size, 0),
  };
}
