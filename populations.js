/** Point populations choose marks; providers remain independent and freely mixable. */
import { assertProviderBudget } from "./provider-budget.js";
import { readProviderBytes } from "./provider-diagnostics.js";
import { scanChunkSize, mapEntryEstimate, yieldScan } from "./scan.js";
export const populations = ["bytes", "pairs", "triples", "bins"];
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
  if (population === "bytes" || population === "bins") return null;
  const source = job.sourceId ?? job.source;
  const representative = job.configuration.tupleRepresentative || "first";
  if (!["first", "last"].includes(representative))
    throw new TypeError("Tuple representative must be first or last");
  const key = `${job.offset}/${job.length}/${population}/${representative}`;
  if (cache.population?.source === source && cache.population.key === key)
    return cache.population.offsets;
  const width = population === "pairs" ? 2 : 3;
  const addresses = new Map();
  const inputBytes = bytes ? 0 : Math.min(scanChunkSize, job.length);
  // The entry estimate is a conservative policy allowance, not a claim about engine Map bytes.
  const entryBytes =
    mapEntryEstimate +
    Float64Array.BYTES_PER_ELEMENT +
    Uint32Array.BYTES_PER_ELEMENT;
  assertProviderBudget(job, inputBytes, "Tuple scan input");
  const budget = job.configuration.providerBudget ?? null;
  const maxEntries =
    budget === null ? Infinity : Math.floor((budget - inputBytes) / entryBytes);
  let tuple = 0;
  let seen = 0;
  const mask = width === 2 ? 0xffff : 0xffffff;
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
  const offsets = Float64Array.from(addresses.values());
  const keys = Uint32Array.from(addresses.keys());
  cache.population = { source, key, offsets, keys, representative };
  return offsets;
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
