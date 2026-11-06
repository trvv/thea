import assert from "node:assert/strict";
import { byteFrequencyTable } from "../byte-frequency.js";
import { populationOffsets, recordPopulation } from "../populations.js";
import { executeRender } from "../rendering.js";
import { RenderCanvas } from "./render-canvas.js";
import { parseProfile, serializeProfile } from "../profiles.js";

const data = Uint8Array.from([99, 65, 0, 65, 255, 0, 65, 66, 65, 88]);
const source = new Blob([data]);
for (const representative of ["first", "last"]) {
  const table = byteFrequencyTable({ representative });
  const job = {
    kind: "view",
    source,
    offset: 1,
    length: 8,
    columns: 256,
    rows: 256,
    region: "linear",
    sampleLayout: { columns: 16, rows: 16 },
    encoding: "ascii",
    blankSpaces: false,
    blankNulls: false,
    ...table,
  };
  const cache = {};
  const offsets = await populationOffsets(job, undefined, cache);
  assert.deepEqual([...cache.population.keys], [0, 65, 66, 255]);
  assert.deepEqual(
    [...offsets],
    representative === "first" ? [1, 0, 6, 3] : [4, 7, 6, 3],
  );
  assert.equal(cache.population.counts[0], 2);
  assert.equal(cache.population.counts[65], 4);
  assert.equal(cache.population.counts[66], 1);
  assert.equal(cache.population.counts[255], 1);
  assert.equal(cache.population.counts[99], 0);
  assert.equal(
    [...cache.population.counts].reduce((a, b) => a + b),
    job.length,
  );
  await executeRender(new RenderCanvas(), job, cache);
  assert.equal(cache.preparedPoints.size, 4);
  assert.deepEqual(cache.preparedPoints.labels, ["00", "41", "42", "FF"]);
  assert.equal(cache.preparedPoints.grid.columns, 16);
  assert.equal(cache.preparedPoints.grid.rows, 16);
  for (const [index, symbol] of [...cache.population.keys].entries()) {
    assert.equal(
      cache.preparedPoints.positions[index * 3],
      ((symbol % 16) + 0.5) / 8 - 1,
    );
    assert.equal(
      cache.preparedPoints.positions[index * 3 + 1],
      (Math.floor(symbol / 16) + 0.5) / 8 - 1,
    );
  }
  const profile = {
    version: 3,
    region: "linear",
    recipes: {},
    ...table,
    coordinateSystem: "cartesian",
    axes: [0, 1],
    rotation: { yaw: -0.6, pitch: 0.45 },
    encoding: "ascii",
    blankSpaces: false,
    blankNulls: false,
    frequencyOpacity: false,
  };
  const restored = parseProfile(serializeProfile(profile));
  assert.equal(restored.configuration.population, "symbols");
  assert.equal(restored.configuration.tupleRepresentative, representative);
  assert.deepEqual(
    restored.configuration.position,
    table.configuration.position,
  );
}
const every = new Blob([Uint8Array.from({ length: 256 }, (_, i) => 255 - i)]);
const allCache = {};
const everyJob = {
  source: every,
  offset: 0,
  length: 256,
  configuration: byteFrequencyTable().configuration,
};
assert.equal(
  (await populationOffsets(everyJob, undefined, allCache)).length,
  256,
);
assert.deepEqual(
  [...allCache.population.keys],
  Array.from({ length: 256 }, (_, i) => i),
);
assert.equal(
  (await populationOffsets({ ...everyJob, length: 0 }, undefined, {})).length,
  0,
);
assert.deepEqual(byteFrequencyTable({ text: false }).shaders, []);
assert.throws(
  () => byteFrequencyTable({ representative: "middle" }),
  /representative/,
);
assert.throws(() => byteFrequencyTable({ text: 1 }), /Text/);
const untouched = byteFrequencyTable();
const changed = byteFrequencyTable();
changed.configuration.position[0].op = "constant";
assert.equal(untouched.configuration.position[0].op, "divide");

// Complete strided records use exact computed addresses and never allocate selection-sized arrays.
for (const [length, stride, origin, width, expected] of [
  [0, 4, 0, 4, []],
  [3, 4, 0, 4, []],
  [4, 4, 0, 4, [0]],
  [13, 4, 1, 4, [1, 5, 9]],
  [13, 4, 2, 4, [2, 6]],
  [5, 1, 0, 3, [0, 1, 2]],
  [10, 3, 12, 1, []],
]) {
  const config = {
    population: "records",
    recordStride: stride,
    recordOrigin: origin,
    recordWidth: width,
  };
  const records = recordPopulation({ length, configuration: config });
  assert.equal(records.count, expected.length);
  assert.deepEqual(
    Array.from({ length: records.count }, (_, index) => records.offset(index)),
    expected,
  );
  assert.throws(() => records.offset(-1), /outside/);
  assert.throws(() => records.offset(records.count), /outside/);
  assert.equal(
    await populationOffsets({ length, configuration: config }, undefined, {}),
    null,
  );
}
const large = recordPopulation({
  length: 2 ** 40 + 7,
  configuration: { recordStride: 3, recordOrigin: 1, recordWidth: 4 },
});
assert.equal(large.offset(2 ** 24 + 1), 1 + (2 ** 24 + 1) * 3);
assert(large.offset(large.count - 1) + large.width <= 2 ** 40 + 7);
for (const configuration of [
  { recordStride: 0 },
  { recordOrigin: -1 },
  { recordWidth: 0 },
  { recordStride: 1.5 },
])
  assert.throws(
    () => recordPopulation({ length: 100, configuration }),
    /Record/,
  );

console.log(
  "Byte frequency/record checks pass: observed symbols, sorted identity, exact counts, first/last addresses,16x16 coordinates/hex text, profiles, independent data and complete strided spans.",
);
