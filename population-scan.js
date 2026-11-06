/** Dense reference for high-cardinality tuple populations. */
import { assertProviderBudget } from "./provider-budget.js";
import { readProviderBytes } from "./provider-diagnostics.js";
import { scanChunkSize, mapEntryEstimate, yieldScan } from "./scan.js";
// Population order is always first encounter. The representative address may be first or last,
// independently of sampling, so changing that relationship never changes tuple membership/order.
export async function scanPopulation(
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
  const prefix = cache.populationScanPrefix;
  delete cache.populationScanPrefix;
  let tuple = 0;
  let seen = 0;
  const mask = width === 1 ? 0xff : width === 2 ? 0xffff : 0xffffff;
  for (let offset = 0; offset < job.length;) {
    const end = Math.min(job.length, offset + scanChunkSize);
    const chunk = bytes
      ? bytes.subarray(offset, end)
      : offset === 0 &&
          prefix?.source === source &&
          prefix.offset === job.offset &&
          prefix.data.length >= end
        ? prefix.data.subarray(0, end)
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
  delete cache.populationScanPrefix;
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
