import assert from "node:assert/strict";
import { depthOrder } from "../src/render/depth-order.js";
import { providerPages } from "../src/data/provider-pages.js";
import { windowEntropy } from "../src/analysis/entropy.js";

const projected = new Float32Array(65536 * 4);
let seed = 123;
for (let i = 0; i < 65536; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  projected[i * 4 + 2] = i % 7 ? (seed | 0) / 1234 : -0;
}
projected[2] = -Infinity;
projected[6] = Infinity;
const expected = Uint32Array.from({ length: 65536 }, (_, i) => i);
expected.sort((a, b) => projected[a * 4 + 2] - projected[b * 4 + 2]);
const order = new Uint32Array(expected.length);
const scratch = {};
depthOrder(projected, order, scratch);
assert.deepEqual(order, expected);
depthOrder(projected, order, scratch);
assert.deepEqual(order, expected);

const bytes = Uint8Array.from(
  { length: 200003 },
  (_, i) => (i * 31 + (i >>> 8)) & 255,
);
const source = new Blob([bytes]);
const cache = {};
const pages = providerPages(cache, source, source);
for (const window of [1, 16, 32, 255, 4096]) {
  const actual = await pages.range(
    65000,
    132000,
    window,
    undefined,
    () => true,
  );
  const expected = windowEntropy(bytes, window, window === 32);
  for (let i = 0; i < actual.length; i++)
    assert.ok(Math.abs(actual[i] - expected[65000 + i]) < 0.000001);
}
const diagnostics = { source: { reads: 0, bytes: 0, milliseconds: 0 } };
await pages.range(65032, 131999, 32, diagnostics, () => true);
assert.equal(diagnostics.source.reads, 0);
providerPages(cache, source, source, 65536);
assert.ok(cache.providerPages.bytes <= 65536);
const replacement = new Blob([new Uint8Array(100)]);
assert.deepEqual(
  await providerPages(cache, replacement, replacement).range(
    0,
    100,
    0,
    undefined,
    () => true,
  ),
  new Uint8Array(100),
);
assert.equal(
  await pages.range(180000, 190000, 0, undefined, () => false),
  null,
);
console.log(
  "Performance reuse passes: stable exact depth order, entropy boundaries, overlap hits, eviction, replacement and cancellation.",
);
