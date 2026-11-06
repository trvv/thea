import { readProviderBytes } from "./provider-diagnostics.js";

/** Incremental selected-window byte/pair/triple histograms, shared by painters and factors. */
/**
 * Operate on half-open ranges of valid tuple starts, not byte coverage; a tuple can include trailing bytes
 * without starting another tuple.
 */
function rangeDifference(start, end, otherStart, otherEnd) {
  const ranges = [];
  if (start < Math.min(end, otherStart))
    ranges.push([start, Math.min(end, otherStart)]);
  if (Math.max(start, otherEnd) < end)
    ranges.push([Math.max(start, otherEnd), end]);
  return ranges;
}

/**
 * Reuse overlapping windows by subtracting outgoing tuples and adding incoming ones. Stage all
 * awaited reads before mutating counts so cancellation cannot poison later frames.
 * @returns {Promise<object|null>} Counts plus revision/changed keys; raster caches may apply only
 *   consecutive revisions.
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
  // For overlapping windows, remove outgoing tuples and add incoming tuples.
  // Read all changes before mutation so a superseded request cannot corrupt the cache.
  if (overlap && changed < end - job.offset && changed <= 1048576) {
    const changes = [];
    let bytesRead = 0;
    for (const [ranges, delta] of [
      [rangeDifference(cached.offset, oldEnd, job.offset, end), -1],
      [rangeDifference(job.offset, end, cached.offset, oldEnd), 1],
    ])
      for (const [start, limit] of ranges) {
        for (let offset = start; offset < limit; offset += 65536) {
          const bytes = await readProviderBytes(
            job.source,
            offset,
            Math.min(limit, offset + 65536) + width - 1,
            diagnostics,
          );
          if (!current()) return null;
          changes.push({ bytes, delta });
          bytesRead += bytes.length;
        }
      }
    if (!current()) return null;
    const started = performance.now();
    const changedKeys = new Set();
    for (const { bytes, delta } of changes)
      for (let i = 0; i + width <= bytes.length; i++) {
        const key =
          width === 1
            ? bytes[i]
            : width === 2
              ? bytes[i] * 256 + bytes[i + 1]
              : bytes[i] * 65536 + bytes[i + 1] * 256 + bytes[i + 2];
        if (width === 3) {
          changedKeys.add(key);
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
      duration: performance.now() - started,
      read: true,
      bytesRead,
    };
  }
  const counts =
    width === 3 ? new Map() : new Float64Array(width === 1 ? 256 : 65536);
  let previous = 0,
    seen = 0,
    duration = 0;
  for (let offset = job.offset; offset < job.offset + job.length;) {
    const bytes = selectedBytes
      ? selectedBytes.subarray(
          offset - job.offset,
          Math.min(offset - job.offset + 65536, job.length),
        )
      : await readProviderBytes(
          job.source,
          offset,
          Math.min(offset + 65536, job.offset + job.length),
          diagnostics,
        );
    if (!current()) return null;
    if (!bytes.length)
      throw new Error("Byte source ended before its declared size.");
    const started = performance.now();
    for (const byte of bytes) {
      previous =
        ((previous << 8) | byte) &
        (width === 3 ? 0xffffff : width === 2 ? 0xffff : 0xff);
      if (seen === width - 1) {
        if (width === 3) counts.set(previous, (counts.get(previous) || 0) + 1);
        else counts[previous]++;
      } else seen++;
    }
    duration += performance.now() - started;
    offset += bytes.length;
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
    bytesRead: job.length,
  };
}

export const trigraphCounts = (job, cache, current) =>
  windowCounts(job, cache, 3, current);
