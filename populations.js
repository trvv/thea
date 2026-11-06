/** Point populations choose marks; providers remain independent and freely mixable. */
import { assertProviderBudget } from "./provider-budget.js";
import { readProviderBytes } from "./provider-diagnostics.js";
import { scanChunkSize, mapEntryEstimate, yieldScan } from "./scan.js";
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
  const symbolBytes =
    population === "symbols" ? 256 * Float64Array.BYTES_PER_ELEMENT : 0;
  const inputBytes =
    (bytes ? 0 : Math.min(scanChunkSize, job.length)) + symbolBytes;
  // The entry estimate is a conservative policy allowance, not a claim about engine Map bytes.
  const entryBytes =
    mapEntryEstimate +
    Float64Array.BYTES_PER_ELEMENT +
    Uint32Array.BYTES_PER_ELEMENT;
  assertProviderBudget(job, inputBytes, "Tuple scan input");
  const symbolCounts = symbolBytes ? new Float64Array(256) : null;
  const addresses = new Map();
  const budget = job.configuration.providerBudget ?? null;
  const maxEntries =
    budget === null ? Infinity : Math.floor((budget - inputBytes) / entryBytes);
  let tuple = 0;
  let seen = 0;
  const mask = width === 1 ? 0xff : width === 2 ? 0xffff : 0xffffff;
  for (let offset = 0; offset < job.length;) {
    const end = Math.min(job.length, offset + scanChunkSize);
    const chunk = bytes
      ? bytes.subarray(offset, end)
      : await readProviderBytes(
          job.source,
          job.offset + offset,
          job.offset + end,
          diagnostics,
        );
    if (!current()) return null;
    if (chunk.length !== end - offset)
      throw new Error("Byte source ended before its declared size.");
    for (let i = 0; i < chunk.length; i++) {
      tuple = ((tuple << 8) | chunk[i]) & mask;
      if (seen >= width - 1) {
        if (symbolCounts) symbolCounts[tuple]++;
        const address = offset + i - width + 1;
        if (!addresses.has(tuple)) {
          if (addresses.size >= maxEntries)
            assertProviderBudget(
              job,
              inputBytes + (addresses.size + 1) * entryBytes,
              "Distinct tuple index (estimated Map storage)",
            );
          addresses.set(tuple, address);
        } else if (representative === "last") addresses.set(tuple, address);
      }
      seen++;
    }
    offset = end;
    if (offset < job.length && !(await yieldScan(current))) return null;
  }
  if (!current()) return null;
  const keys = Uint32Array.from(addresses.keys());
  if (symbolCounts) keys.sort();
  const offsets = symbolCounts
    ? Float64Array.from(keys, (symbol) => addresses.get(symbol))
    : Float64Array.from(addresses.values());
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
