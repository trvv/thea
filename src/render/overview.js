/**
 * Exact overview averages with source-owned immutable page summaries. Bars keep their own raster
 * state while overlapping scopes share reads in this execution context.
 * @module overview
 */
const PAGE_SIZE = 65536;
const PREFIX_BUDGET = 16 * 1024 * 1024;
const TOTAL_LIMIT = 4096;
const summaries = new WeakMap();

function sourceSummaries(source) {
  let shared = summaries.get(source);
  if (!shared) {
    shared = {
      source,
      pages: new Map(),
      totals: new Map(),
      pending: new Map(),
      prefixBytes: 0,
    };
    summaries.set(source, shared);
  }
  return shared;
}

function touch(map, key, value) {
  map.delete(key);
  map.set(key, value);
}

function retainTotal(shared, page, total) {
  touch(shared.totals, page, total);
  if (shared.totals.size > TOTAL_LIMIT)
    shared.totals.delete(shared.totals.keys().next().value);
}

function retainPage(shared, page, prefix) {
  const previous = shared.pages.get(page);
  if (previous) shared.prefixBytes -= previous.byteLength;
  touch(shared.pages, page, prefix);
  shared.prefixBytes += prefix.byteLength;
  while (shared.prefixBytes > PREFIX_BUDGET) {
    const oldest = shared.pages.keys().next().value;
    shared.prefixBytes -= shared.pages.get(oldest).byteLength;
    shared.pages.delete(oldest);
  }
  retainTotal(shared, page, prefix[prefix.length - 1]);
}

/** A consumer's cancellation never cancels another consumer's immutable source read. */
async function readPage(shared, page) {
  const cached = shared.pages.get(page);
  if (cached) {
    retainPage(shared, page, cached);
    return { prefix: cached, bytesRead: 0, duration: 0 };
  }
  const pending = shared.pending.get(page);
  if (pending) {
    const { prefix } = await pending;
    return { prefix, bytesRead: 0, duration: 0 };
  }
  const operation = (async () => {
    const start = page * PAGE_SIZE;
    const end = Math.min(shared.source.size, start + PAGE_SIZE);
    const bytes = new Uint8Array(
      await shared.source.slice(start, end).arrayBuffer(),
    );
    if (!bytes.length || bytes.length !== end - start)
      throw new Error("Byte source ended before its declared size.");
    const started = performance.now();
    const prefix = new Uint32Array(bytes.length + 1);
    for (let i = 0; i < bytes.length; i++) prefix[i + 1] = prefix[i] + bytes[i];
    retainPage(shared, page, prefix);
    return {
      prefix,
      bytesRead: bytes.length,
      duration: performance.now() - started,
    };
  })();
  shared.pending.set(page, operation);
  try {
    return await operation;
  } finally {
    // Rejections are not retained: a later read may retry the same page.
    shared.pending.delete(page);
  }
}

/** Developer accounting only; Map overhead and transient read buffers are not byte estimates. */
export function overviewSummaryStats(source) {
  const shared = summaries.get(source);
  return {
    pages: shared?.pages.size || 0,
    prefixBytes: shared?.prefixBytes || 0,
    prefixBudget: PREFIX_BUDGET,
    totals: shared?.totals.size || 0,
    totalLimit: TOTAL_LIMIT,
    pending: shared?.pending.size || 0,
  };
}

/**
 * Use root-source page sums so nested bars can change scope without rereading unchanged pages.
 * Empty subpixel ranges repeat the previous value deliberately.
 * @param {object} job Bar snapshot; offset is root-source-relative and length is its displayed scope.
 * @param {object} cache Per-bar frame cache. Source summaries are shared by actual Blob identity;
 *   engine-local sourceId is used only to recognize cloned snapshots inside this cache owner.
 * @param {function(): boolean} current Check after awaited work before publishing this bar's frame.
 * @returns {Promise<object|null>} Exact averages and work metrics, or null after supersession.
 */
export async function overviewValues(job, cache, current = () => true) {
  if (!current()) return null;
  const sameSource =
    cache.overview &&
    (job.sourceId === undefined
      ? cache.overview.source === job.source
      : cache.overview.sourceId === job.sourceId);
  if (!sameSource) {
    const shared = sourceSummaries(job.source);
    cache.overview = {
      source: job.source,
      sourceId: job.sourceId,
      shared,
      // Retained for existing developer cache inspection; renderers never mutate summaries.
      pages: shared.pages,
      totals: shared.totals,
    };
  }
  const owner = cache.overview;
  const shared = owner.shared;
  const count = job.width * job.height;
  const values = new Uint8Array(count);
  const sourceSize = job.source.size;
  const length = job.length ?? sourceSize;
  const wholePages = length >= count * PAGE_SIZE;
  const base = job.offset || 0;
  const frameKey = `${base}/${length}/${count}`;
  if (owner.frame?.key === frameKey)
    return { values: owner.frame.values, duration: 0, bytesRead: 0 };
  let pageIndex = -1;
  let prefix;
  let previous = 0;
  let bytesRead = 0;
  let duration = 0;
  let started = performance.now();
  for (let pixel = 0; pixel < count; pixel++) {
    const start = Math.ceil((pixel * length) / count);
    const end = Math.ceil(((pixel + 1) * length) / count);
    let sum = 0;
    for (let offset = base + start; offset < base + end;) {
      const page = Math.floor(offset / PAGE_SIZE);
      // Whole-page totals survive detail-page eviction, subject to their own bounded LRU.
      if (
        wholePages &&
        offset === page * PAGE_SIZE &&
        shared.totals.has(page)
      ) {
        const pageEnd = Math.min(sourceSize, (page + 1) * PAGE_SIZE);
        if (pageEnd <= base + end) {
          const total = shared.totals.get(page);
          touch(shared.totals, page, total);
          sum += total;
          offset = pageEnd;
          continue;
        }
      }
      if (page !== pageIndex) {
        duration += performance.now() - started;
        const result = await readPage(shared, page);
        if (!current()) return null;
        started = performance.now();
        prefix = result.prefix;
        bytesRead += result.bytesRead;
        duration += result.duration;
        pageIndex = page;
      }
      const left = offset - page * PAGE_SIZE;
      const right = Math.min(prefix.length - 1, base + end - page * PAGE_SIZE);
      if (right <= left)
        throw new Error("Byte source ended before its declared size.");
      sum += prefix[right] - prefix[left];
      offset += right - left;
    }
    if (end > start) previous = sum / (end - start);
    values[pixel] = previous;
  }
  duration += performance.now() - started;
  if (!current()) return null;
  owner.frame = { key: frameKey, values };
  return { values, duration, bytesRead };
}
