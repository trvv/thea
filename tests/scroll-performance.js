import assert from "node:assert/strict";
import { trigraphCounts } from "../histograms.js";
import { overviewValues } from "../overview.js";
import { RenderCanvas } from "./render-canvas.js";

const data = Uint8Array.from(
  { length: 131200 },
  (_, i) => (i * i + i * 17 + Math.floor(i / 31)) & 255,
);
const source = new Blob([data]);
const cache = {};
let seed = 123;
const random = (max) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % max;
};
const referenceTriples = (offset, length) => {
  const counts = new Map();
  for (let i = offset; i + 2 < offset + length; i++) {
    const triple = data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
    counts.set(triple, (counts.get(triple) || 0) + 1);
  }
  return counts;
};
for (let frame = 0; frame < 200; frame++) {
  const offset = frame < 100 ? 65000 + random(200) : random(100000);
  const length = frame < 100 ? 3000 + random(400) : random(30000);
  const histogram = await trigraphCounts({ source, offset, length }, cache);
  assert.deepEqual(
    histogram.counts,
    referenceTriples(offset, length),
    `Incremental histogram mismatch at frame ${frame}`,
  );
}
await trigraphCounts({ source, offset: 0, length: 65536 }, cache);
const next = await trigraphCounts({ source, offset: 32, length: 65536 }, cache);
assert(next.bytesRead <= 68, "Small scroll rescanned the whole selection");
const beforeCancelled = new Map(cache.trigraph.counts);
assert.equal(
  await trigraphCounts(
    { source, offset: 48, length: 65536 },
    cache,
    () => false,
  ),
  null,
);
assert.deepEqual(
  cache.trigraph.counts,
  beforeCancelled,
  "Cancelled incremental update mutated counts",
);
assert.equal(cache.trigraph.offset, 32);

const referenceOverview = (offset, length, count) => {
  const sums = new Float64Array(count),
    counts = new Uint32Array(count);
  for (let i = 0; i < length; i++) {
    const pixel = Math.floor((i * count) / length);
    sums[pixel] += data[offset + i];
    counts[pixel]++;
  }
  let previous = 0;
  return Uint8Array.from(sums, (sum, i) => {
    if (counts[i]) previous = sum / counts[i];
    return previous;
  });
};
const overviewCache = {};
for (const length of [0, 1, 2, 31, 997, 65537])
  for (const offset of [0, 127, 65535]) {
    const result = await overviewValues(
      { source, offset, length, width: 13, height: 7 },
      overviewCache,
    );
    assert.deepEqual(result.values, referenceOverview(offset, length, 91));
  }
const firstOverview = await overviewValues(
  { source, offset: 0, length: 65536, width: 48, height: 100 },
  {},
);
assert(firstOverview.bytesRead > 0);
const hit = await overviewValues(
  { source, offset: 1, length: 65536, width: 48, height: 100 },
  overviewCache,
);
assert.equal(hit.bytesRead, 0, "Moving inside cached pages reread the buffer");
const large = new Blob([new Uint8Array(5 * 1024 * 1024)]);
const boundedCache = {};
await overviewValues({ source: large, width: 48, height: 100 }, boundedCache);
assert(
  boundedCache.overview.pages.size <= 64,
  "Overview cache exceeded its memory bound",
);
console.log(
  "Scroll checks pass: incremental histogram equivalence, cancelled updates, exact overview averages, cached reads, bounded memory.",
);
