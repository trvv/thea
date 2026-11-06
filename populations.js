import { scanPopulation } from "./population-scan.js";
import { tupleIndex } from "./tuple-index.js";
/** Point populations choose marks; providers remain independent and freely mixable. */
export const populations = [
  "bytes",
  "symbols",
  "records",
  "pairs",
  "triples",
  "bins",
];
export const defaultSampleLimit = 262144;

// Population order is always first encounter. The representative address may be first or last,
// independently of sampling, so changing that relationship never changes tuple membership/order.
export async function populationOffsets(
  job,
  bytes,
  cache,
  current = () => true,
  diagnostics,
) {
  if (!current()) return null;
  const population = job.configuration.population || "bytes";
  if (["bytes", "records", "bins"].includes(population)) return null;
  const source = job.sourceId ?? job.source;
  const representative = job.configuration.tupleRepresentative || "first";
  if (!["first", "last"].includes(representative))
    throw new TypeError("Tuple representative must be first or last");
  const key = `${job.offset}/${job.length}/${population}/${representative}`;
  if (cache.population?.source === source && cache.population.key === key)
    return cache.population.offsets;
  const width = population === "symbols" ? 1 : population === "pairs" ? 2 : 3;
  const index = await tupleIndex(
    job,
    bytes,
    cache,
    width,
    current,
    diagnostics,
  );
  if (index === undefined)
    return scanPopulation(job, bytes, cache, current, diagnostics);
  if (!index || !current()) return null;
  const keys = index.keys;
  const offsets = Float64Array.from(
    keys,
    (key) => index.entries.get(key)[representative] - job.offset,
  );
  const symbolCounts =
    population === "symbols"
      ? Float64Array.from(
          { length: 256 },
          (_, key) => index.entries.get(key)?.count || 0,
        )
      : null;
  cache.population = {
    source,
    key,
    offsets,
    keys,
    representative,
    ...(symbolCounts ? { counts: symbolCounts } : {}),
  };
  return offsets;
}

/** Enumerate complete strided spans without allocating one address per record. */
export function recordPopulation(job) {
  const stride = job.configuration.recordStride ?? 1;
  const origin = job.configuration.recordOrigin ?? 0;
  const width = job.configuration.recordWidth ?? 1;
  if (
    !Number.isSafeInteger(stride) ||
    stride < 1 ||
    !Number.isSafeInteger(origin) ||
    origin < 0 ||
    !Number.isSafeInteger(width) ||
    width < 1
  )
    throw new TypeError(
      "Record stride/width must be positive integers and origin nonnegative",
    );
  const count =
    origin > job.length - width
      ? 0
      : Math.floor((job.length - origin - width) / stride) + 1;
  return {
    count,
    stride,
    origin,
    width,
    offset(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= count)
        throw new RangeError("Record index is outside the population");
      return origin + index * stride;
    },
  };
}

export function limitedSampleLayout(layout, configuration) {
  const limit =
    configuration.sampleLimit === null
      ? Infinity
      : (configuration.sampleLimit ?? defaultSampleLimit);
  if (layout.columns * layout.rows <= limit) return layout;
  const columns = Math.max(
    1,
    Math.min(
      limit,
      Math.round(Math.sqrt((limit * layout.columns) / layout.rows)),
    ),
  );
  return { ...layout, columns, rows: Math.max(1, Math.floor(limit / columns)) };
}
