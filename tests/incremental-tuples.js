import assert from "node:assert/strict";
import { populationOffsets } from "../src/data/populations.js";
import { createProviderDiagnostics } from "../src/data/provider-diagnostics.js";
let seed = 91;
for (const repeated of [false, true]) {
  const data = Uint8Array.from({ length: 200000 }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return repeated ? (i % 17 ? i % 4 : 71) : seed >>> 24;
  });
  const source = new Blob([data]);
  for (const population of ["symbols", "pairs", "triples"]) {
    const cache = {};
    for (const [offset, length] of [
      [100, 100000],
      [132, 100000],
      [111, 99950],
      [90, 100050],
      [1000, 99500],
    ]) {
      for (const tupleRepresentative of ["first", "last"]) {
        const job = {
          source,
          offset,
          length,
          configuration: { population, tupleRepresentative },
        };
        const actual = await populationOffsets(job, undefined, cache);
        const referenceCache = {};
        const reference = await populationOffsets(
          job,
          data.subarray(offset, offset + length),
          referenceCache,
        );
        assert.deepEqual(actual, reference);
        assert.deepEqual(cache.population.keys, referenceCache.population.keys);
        assert.deepEqual(
          cache.population.counts,
          referenceCache.population.counts,
        );
      }
    }
  }
}
const source = new Blob([new Uint8Array(200000)]);
const cache = {};
const base = {
  source,
  offset: 0,
  length: 100000,
  configuration: { population: "triples" },
};
await populationOffsets(base, undefined, cache);
const diagnostics = createProviderDiagnostics({ diagnostics: true });
await populationOffsets(
  { ...base, offset: 32 },
  undefined,
  cache,
  () => true,
  diagnostics,
);
assert.equal(cache.tupleIndex.incremental, true);
assert.ok(diagnostics.source.bytes < 100000);
const retained = cache.tupleIndex;
let checks = 0;
assert.equal(
  await populationOffsets(
    { ...base, offset: 64 },
    undefined,
    cache,
    () => ++checks < 4,
  ),
  null,
);
assert.equal(cache.tupleIndex, retained);
console.log(
  "Incremental tuples pass: first/last order, counts, forward/backward/resized moves, random/repeated content, cancellation and reduced reads.",
);
