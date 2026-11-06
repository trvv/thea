import assert from "node:assert/strict";
import {
  overviewValues,
  overviewSummaryStats,
} from "../src/render/overview.js";

const PAGE_SIZE = 65536;
const data = Uint8Array.from(
  { length: PAGE_SIZE * 3 + 17 },
  (_, i) => (i * 19 + Math.floor(i / 37)) & 255,
);
const blob = new Blob([data]);
let reads = 0;
let release;
let waiting = new Promise((resolve) => {
  release = resolve;
});
const source = {
  size: blob.size,
  slice(start, end) {
    reads++;
    return {
      async arrayBuffer() {
        await waiting;
        return blob.slice(start, end).arrayBuffer();
      },
    };
  },
};
const job = {
  source,
  offset: 17,
  length: PAGE_SIZE + 91,
  width: 13,
  height: 7,
};
const reference = ({ offset = 0, length = data.length, width, height }) => {
  let previous = 0;
  return Uint8Array.from({ length: width * height }, (_, pixel) => {
    const start = Math.ceil((pixel * length) / (width * height));
    const end = Math.ceil(((pixel + 1) * length) / (width * height));
    if (start < end) {
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[offset + i];
      previous = sum / (end - start);
    }
    return previous;
  });
};

const firstCache = {};
const secondCache = {};
const first = overviewValues(job, firstCache);
const second = overviewValues(job, secondCache);
assert.equal(reads, 1, "Concurrent bars duplicated an in-flight read");
assert.equal(overviewSummaryStats(source).pending, 1);
release();
const results = await Promise.all([first, second]);
assert.equal(reads, 2, "Both bars should share the same two source pages");
assert.deepEqual(results[0].values, reference(job));
assert.deepEqual(results[1].values, reference(job));
assert.equal(results[0].bytesRead + results[1].bytesRead, PAGE_SIZE * 2);
assert.notEqual(firstCache.overview.frame, secondCache.overview.frame);
assert.equal(firstCache.overview.pages, secondCache.overview.pages);
assert.equal(overviewSummaryStats(source).pending, 0);
const overlap = { ...job, offset: 29, length: 997, width: 7, height: 19 };
assert.deepEqual(
  (await overviewValues(overlap, {})).values,
  reference(overlap),
);
assert.equal(reads, 2, "Overlapping new bars should reuse completed pages");

// A canceled consumer must neither publish its frame nor poison another waiter or the cache.
waiting = new Promise((resolve) => {
  release = resolve;
});
const later = { ...job, offset: PAGE_SIZE * 2 + 31, length: 997 };
let current = true;
const canceledCache = {};
const canceled = overviewValues(later, canceledCache, () => current);
const useful = overviewValues(later, {});
assert.equal(reads, 3);
current = false;
release();
assert.equal(await canceled, null);
assert.equal(canceledCache.overview.frame, undefined);
assert.deepEqual((await useful).values, reference(later));
assert.equal(reads, 3);
assert.equal((await overviewValues(later, {})).bytesRead, 0);
assert.equal(await overviewValues(job, {}, () => false), null);
assert.equal(
  reads,
  3,
  "An already obsolete consumer should not initiate reads",
);

// Failed reads are removed from the shared promise cache, allowing a real retry.
let attempts = 0;
const unreliable = {
  size: blob.size,
  slice(start, end) {
    attempts++;
    return {
      async arrayBuffer() {
        if (attempts === 1) throw new Error("temporary read failure");
        return blob.slice(start, end).arrayBuffer();
      },
    };
  },
};
const retryJob = { ...job, source: unreliable, length: 100 };
await assert.rejects(overviewValues(retryJob, {}), /temporary read failure/);
assert.equal(overviewSummaryStats(unreliable).pending, 0);
assert.deepEqual(
  (await overviewValues(retryJob, {})).values,
  reference(retryJob),
);
assert.equal(attempts, 2);
const truncated = {
  size: PAGE_SIZE,
  slice: () => new Blob([new Uint8Array(31)]),
};
await assert.rejects(
  overviewValues({ ...job, source: truncated, offset: 0, length: 1 }, {}),
  /ended before its declared size/,
);
assert.equal(overviewSummaryStats(truncated).totals, 0);
assert.equal(overviewSummaryStats(truncated).pending, 0);

// Engine-local numeric IDs are not shared-source keys; unrelated roots stay isolated.
const different = new Blob([new Uint8Array(blob.size).fill(255)]);
const fresh = await overviewValues(
  { ...job, source: different, sourceId: 1 },
  {},
);
assert(fresh.values.every((value) => value === 255));
assert.notEqual(overviewSummaryStats(different).prefixBytes, 0);
const replaced = await overviewValues(
  { ...job, source: different, sourceId: 2 },
  firstCache,
);
assert(replaced.values.every((value) => value === 255));

// Prefix detail has one source budget across bars, and retained totals avoid a repeated full scan.
let largeReads = 0;
const large = {
  size: PAGE_SIZE * 70,
  slice(start, end) {
    largeReads++;
    return new Blob([new Uint8Array(end - start).fill(7)]);
  },
};
const largeJob = {
  source: large,
  offset: 0,
  length: large.size,
  width: 1,
  height: 1,
};
assert.deepEqual((await overviewValues(largeJob, {})).values, Uint8Array.of(7));
const stats = overviewSummaryStats(large);
assert(stats.prefixBytes <= stats.prefixBudget);
assert(stats.pages < 70);
assert(stats.totals <= stats.totalLimit);
assert.equal(largeReads, 70);
assert.deepEqual((await overviewValues(largeJob, {})).values, Uint8Array.of(7));
assert.equal(
  largeReads,
  70,
  "Whole-page totals should survive prefix eviction",
);
// Request an evicted fragment, forcing an exact reread without exceeding the same shared budget.
const fragment = await overviewValues(
  { ...largeJob, offset: 1, length: 3 },
  {},
);
assert.deepEqual(fragment.values, Uint8Array.of(7));
assert.equal(largeReads, 71);
assert(overviewSummaryStats(large).prefixBytes <= stats.prefixBudget);

// Coarse totals have their own cap even when a source spans many more pages than detail memory.
const totalLimit = overviewSummaryStats(large).totalLimit;
const zeroPage = new ArrayBuffer(PAGE_SIZE);
let broadReads = 0;
const broad = {
  size: (totalLimit + 1) * PAGE_SIZE,
  slice() {
    broadReads++;
    return { arrayBuffer: async () => zeroPage };
  },
};
const broadJob = { source: broad, width: 1, height: 1 };
assert.deepEqual((await overviewValues(broadJob, {})).values, Uint8Array.of(0));
const broadStats = overviewSummaryStats(broad);
assert.equal(broadStats.totals, totalLimit);
assert(broadStats.prefixBytes <= broadStats.prefixBudget);
assert.equal(broadReads, totalLimit + 1);
await overviewValues({ ...broadJob, offset: 0, length: PAGE_SIZE }, {});
assert.equal(
  broadReads,
  totalLimit + 2,
  "An evicted total must be recomputed exactly",
);

console.log(
  "Overview sharing passes: concurrent deduplication, exact sums, independent frames, canceled waiters, retry, source identity, bounded detail and retained coarse totals.",
);
