/** Incremental selected-window byte/pair/triple histograms with atomic cache publication. */
import { readProviderBytes } from "./provider-diagnostics.js";
import { assertProviderBudget } from "./provider-budget.js";
import { scanChunkSize, mapEntryEstimate, yieldScan } from "./scan.js";

/** Ranges describe valid tuple starts, not byte coverage. */
function rangeDifference(start, end, otherStart, otherEnd) {
  const ranges = [];
  if (start < Math.min(end, otherStart))
    ranges.push([start, Math.min(end, otherStart)]);
  if (Math.max(start, otherEnd) < end)
    ranges.push([Math.max(start, otherEnd), end]);
  return ranges;
}

const tupleKey = (bytes, index, width) =>
  width === 1
    ? bytes[index]
    : width === 2
      ? bytes[index] * 256 + bytes[index + 1]
      : bytes[index] * 65536 + bytes[index + 1] * 256 + bytes[index + 2];

/**
 * Source reads and delta calculation are bounded and yield between chunks. Incremental changes
 * remain detached until one bounded synchronous commit; canceled scans never mutate live counts.
 * @returns {Promise<object|null>} Exact counts/revision/changed keys, or null after supersession.
 */
export async function windowCounts(
  job,
  cache,
  width,
  current = () => true,
  selectedBytes,
  diagnostics,
) {
  const cacheKey = ["", "byteHistogram", "pairHistogram", "trigraph"][width];
  if (!cacheKey) throw new TypeError("Expected a tuple width from 1 to 3");
  if (!current()) return null;
  const cached = cache[cacheKey];
  const sameSource =
    cached &&
    (job.sourceId === undefined
      ? cached.source === job.source
      : cached.sourceId === job.sourceId);
  if (
    sameSource &&
    cached.offset === job.offset &&
    cached.length === job.length
  ) {
    return {
      counts: cached.counts,
      revision: cached.revision,
      changed: cached.changed,
      duration: 0,
      read: false,
      bytesRead: 0,
    };
  }
  const oldEnd = cached
    ? cached.offset + Math.max(0, cached.length - width + 1)
    : 0;
  const end = job.offset + Math.max(0, job.length - width + 1);
  const overlap = sameSource
    ? Math.max(0, Math.min(oldEnd, end) - Math.max(cached.offset, job.offset))
    : 0;
  const changed = cached
    ? oldEnd - cached.offset + end - job.offset - 2 * overlap
    : Infinity;
  // Limit the final non-yielding commit to one scan chunk. Larger changes use a detached full scan.
  if (overlap && changed < end - job.offset && changed <= scanChunkSize) {
    const deltas = new Map();
    let bytesRead = 0;
    let duration = 0;
    const retained =
      width === 3
        ? cached.counts.size * mapEntryEstimate
        : cached.counts.byteLength;
    const inputBytes = Math.min(changed, scanChunkSize) + width - 1;
    assertProviderBudget(job, retained + inputBytes, "Incremental histogram");
    for (const [ranges, delta] of [
      [rangeDifference(cached.offset, oldEnd, job.offset, end), -1],
      [rangeDifference(job.offset, end, cached.offset, oldEnd), 1],
    ]) {
      for (const [start, limit] of ranges) {
        for (let offset = start; offset < limit; offset += scanChunkSize) {
          const blockEnd = Math.min(limit, offset + scanChunkSize);
          const bytes = await readProviderBytes(
            job.source,
            offset,
            blockEnd + width - 1,
            diagnostics,
          );
          if (!current()) return null;
          if (bytes.length !== blockEnd + width - 1 - offset)
            throw new Error("Byte source ended before its declared size.");
          bytesRead += bytes.length;
          const started = performance.now();
          for (let i = 0; i + width <= bytes.length; i++) {
            const key = tupleKey(bytes, i, width);
            if (!deltas.has(key))
              assertProviderBudget(
                job,
                retained +
                  inputBytes +
                  (deltas.size + 1) * mapEntryEstimate * 2,
                "Incremental histogram deltas (estimated Map/Set storage)",
              );
            deltas.set(key, (deltas.get(key) || 0) + delta);
          }
          duration += performance.now() - started;
          if (!(await yieldScan(current))) return null;
        }
      }
    }
    if (!current()) return null;
    const started = performance.now();
    const changedKeys = width === 3 ? new Set(deltas.keys()) : new Set();
    for (const [key, delta] of deltas) {
      if (width === 3) {
        const count = (cached.counts.get(key) || 0) + delta;
        if (count) cached.counts.set(key, count);
        else cached.counts.delete(key);
      } else cached.counts[key] += delta;
    }
    Object.assign(cached, {
      source: job.source,
      offset: job.offset,
      length: job.length,
      revision: cached.revision + 1,
      changed: changedKeys,
    });
    return {
      counts: cached.counts,
      revision: cached.revision,
      changed: changedKeys,
      duration: duration + performance.now() - started,
      read: true,
      bytesRead,
    };
  }

  const inputBytes = selectedBytes ? 0 : Math.min(job.length, scanChunkSize);
  const tableBytes =
    width === 3
      ? 0
      : (width === 1 ? 256 : 65536) * Float64Array.BYTES_PER_ELEMENT;
  assertProviderBudget(job, inputBytes + tableBytes, "Histogram scan");
  const budget = job.configuration?.providerBudget ?? null;
  const maxEntries =
    budget === null
      ? Infinity
      : Math.floor((budget - inputBytes) / mapEntryEstimate);
  const counts =
    width === 3 ? new Map() : new Float64Array(width === 1 ? 256 : 65536);
  let previous = 0;
  let seen = 0;
  let duration = 0;
  let bytesRead = 0;
  for (let offset = job.offset; offset < job.offset + job.length;) {
    const limit = Math.min(offset + scanChunkSize, job.offset + job.length);
    const bytes = selectedBytes
      ? selectedBytes.subarray(offset - job.offset, limit - job.offset)
      : await readProviderBytes(job.source, offset, limit, diagnostics);
    if (!current()) return null;
    if (bytes.length !== limit - offset)
      throw new Error("Byte source ended before its declared size.");
    if (!selectedBytes) bytesRead += bytes.length;
    const started = performance.now();
    for (const byte of bytes) {
      previous =
        ((previous << 8) | byte) &
        (width === 3 ? 0xffffff : width === 2 ? 0xffff : 0xff);
      if (seen === width - 1) {
        if (width === 3) {
          if (!counts.has(previous) && counts.size >= maxEntries)
            assertProviderBudget(
              job,
              inputBytes + (counts.size + 1) * mapEntryEstimate,
              "Triple histogram (estimated Map storage)",
            );
          counts.set(previous, (counts.get(previous) || 0) + 1);
        } else counts[previous]++;
      } else seen++;
    }
    duration += performance.now() - started;
    offset = limit;
    if (offset < job.offset + job.length && !(await yieldScan(current)))
      return null;
  }
  if (!current()) return null;
  cache[cacheKey] = {
    source: job.source,
    sourceId: job.sourceId,
    offset: job.offset,
    length: job.length,
    counts,
    revision: 1,
    changed: null,
  };
  return {
    counts,
    revision: 1,
    changed: null,
    duration,
    read: true,
    bytesRead,
  };
}

export const trigraphCounts = (job, cache, current) =>
  windowCounts(job, cache, 3, current);
