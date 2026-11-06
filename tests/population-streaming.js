import assert from "node:assert/strict";
import { populationOffsets } from "../populations.js";
import { windowCounts } from "../histograms.js";
import { createProviderDiagnostics } from "../provider-diagnostics.js";
import { scanChunkSize } from "../scan.js";

const data = Uint8Array.from(
  { length: scanChunkSize * 3 + 17 },
  (_, i) => (i * 17 + Math.floor(i / 31)) & 255,
);
const blob = new Blob([data]);
const reads = [];
const source = {
  size: blob.size,
  slice(start, end) {
    reads.push([start, end]);
    return blob.slice(start, end);
  },
};
const reference = (bytes, width, representative) => {
  const map = new Map();
  for (let i = 0; i + width <= bytes.length; i++) {
    let key = 0;
    for (let j = 0; j < width; j++) key = key * 256 + bytes[i + j];
    if (!map.has(key) || representative === "last") map.set(key, i);
  }
  return map;
};
const job = (population = "pairs", tupleRepresentative = "first") => ({
  source,
  offset: 7,
  length: data.length - 13,
  configuration: { population, tupleRepresentative },
});
for (const [population, width] of [
  ["pairs", 2],
  ["triples", 3],
]) {
  let firstKeys;
  for (const representative of ["first", "last"]) {
    const config = job(population, representative);
    const expected = reference(
      data.subarray(config.offset, config.offset + config.length),
      width,
      representative,
    );
    const cache = {};
    const metrics = createProviderDiagnostics({ diagnostics: true });
    const offsets = await populationOffsets(
      config,
      undefined,
      cache,
      () => true,
      metrics,
    );
    assert.deepEqual([...offsets], [...expected.values()]);
    assert.deepEqual([...cache.population.keys], [...expected.keys()]);
    assert.equal(cache.population.representative, representative);
    assert.equal(
      metrics.source.bytes,
      cache.tupleIndex?.disabled
        ? config.length
        : config.length +
            (Math.ceil(
              (config.length - width + 1) / (scanChunkSize - width + 1),
            ) -
              1) *
              (width - 1),
    );
    assert(reads.every(([start, end]) => end - start <= scanChunkSize));
    if (firstKeys)
      assert.deepEqual(
        cache.population.keys,
        firstKeys,
        "Last representative changed enumeration",
      );
    else firstKeys = cache.population.keys;
    const countBefore = reads.length;
    assert.equal(await populationOffsets(config, undefined, cache), offsets);
    assert.equal(reads.length, countBefore, "Warm population reread source");
    const buffered = await populationOffsets(
      config,
      data.subarray(config.offset, config.offset + config.length),
      {},
    );
    assert.deepEqual(buffered, offsets);
  }
}

// Deliberately put distinct first occurrences across scan boundaries and retain overlapping tuples.
const edges = new Uint8Array(scanChunkSize + 5);
edges.set([1, 2, 3, 1, 2], scanChunkSize - 2);
for (const [population, width] of [
  ["pairs", 2],
  ["triples", 3],
]) {
  const edgeJob = {
    source: new Blob([edges]),
    offset: 0,
    length: edges.length,
    configuration: { population },
  };
  const edgeCache = {};
  const expected = reference(edges, width, "first");
  assert.deepEqual(
    [...(await populationOffsets(edgeJob, undefined, edgeCache))],
    [...expected.values()],
  );
  assert.deepEqual([...edgeCache.population.keys], [...expected.keys()]);
}

// Actual event-loop cancellation during a buffered scan must not publish its detached result.
const longBytes = Uint8Array.from(
  { length: scanChunkSize * 64 },
  (_, i) => data[i % data.length],
);
const longJob = {
  source: new Blob([longBytes]),
  offset: 0,
  length: longBytes.length,
  configuration: { population: "triples" },
};
let current = true;
const canceledCache = {};
const timer = setTimeout(() => {
  current = false;
}, 0);
assert.equal(
  await populationOffsets(longJob, longBytes, canceledCache, () => current),
  null,
);
clearTimeout(timer);
assert.equal(canceledCache.population, undefined);
const original = await populationOffsets(
  job("pairs"),
  undefined,
  canceledCache,
);
current = true;
const cancelReplacement = setTimeout(() => {
  current = false;
}, 0);
assert.equal(
  await populationOffsets(longJob, longBytes, canceledCache, () => current),
  null,
);
clearTimeout(cancelReplacement);
assert.equal(canceledCache.population.offsets, original);

// Exceeding an explicit budget must not truncate distinct membership or overwrite a valid cache.
const tiny = {
  ...job("triples"),
  configuration: { population: "triples", providerBudget: 128 },
};
await assert.rejects(
  populationOffsets(tiny, data.subarray(7, data.length - 6), canceledCache),
  /estimated Map storage/,
);
assert.equal(canceledCache.population.offsets, original);
const short = {
  source: new Blob([Uint8Array.of(1, 2)]),
  offset: 0,
  length: 2,
  configuration: { population: "triples" },
};
assert.equal((await populationOffsets(short, undefined, {})).length, 0);
assert.equal(
  await populationOffsets(
    { ...short, configuration: { population: "bytes" } },
    undefined,
    {},
  ),
  null,
);

// Streamed histograms equal direct counts, including tuples crossing every chunk boundary.
for (const width of [1, 2, 3]) {
  const config = job();
  const counts = (await windowCounts(config, {}, width)).counts;
  const expected = new Map();
  const selected = data.subarray(config.offset, config.offset + config.length);
  for (let i = 0; i + width <= selected.length; i++) {
    let key = 0;
    for (let j = 0; j < width; j++) key = key * 256 + selected[i + j];
    expected.set(key, (expected.get(key) || 0) + 1);
  }
  if (width === 3) assert.deepEqual(counts, expected);
  else
    for (let key = 0; key < counts.length; key++)
      assert.equal(counts[key], expected.get(key) || 0);
}
const histogramCache = {};
const base = { ...job(), offset: 0, length: scanChunkSize * 2 };
const before = await windowCounts(base, histogramCache, 3);
const beforeCounts = new Map(before.counts);
let checks = 0;
assert.equal(
  await windowCounts(
    { ...base, offset: 1000 },
    histogramCache,
    3,
    () => ++checks < 4,
  ),
  null,
);
assert.deepEqual(histogramCache.trigraph.counts, beforeCounts);
assert.equal(histogramCache.trigraph.offset, 0);
assert.equal(histogramCache.trigraph.revision, 1);
const failedCache = {};
await assert.rejects(
  windowCounts(
    { ...base, configuration: { providerBudget: 100 } },
    failedCache,
    2,
  ),
  /Histogram scan/,
);
assert.equal(failedCache.pairHistogram, undefined);
await assert.rejects(
  windowCounts(
    { ...base, configuration: { providerBudget: scanChunkSize + 100 } },
    failedCache,
    3,
  ),
  /estimated Map storage/,
);
assert.equal(failedCache.trigraph, undefined);
const truncated = { size: 100, slice: () => new Blob([new Uint8Array(3)]) };
await assert.rejects(
  windowCounts({ source: truncated, offset: 0, length: 100 }, {}, 1),
  /ended before/,
);
await assert.rejects(
  populationOffsets(
    {
      source: truncated,
      offset: 0,
      length: 100,
      configuration: { population: "pairs" },
    },
    undefined,
    {},
  ),
  /ended before/,
);

console.log(
  "Population/scan checks pass: streamed exact tuples/counts, chunk boundaries, stable first/last ordering, warm reuse, real-task cancellation, atomic deltas, budgets and short sources.",
);
