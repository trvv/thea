import assert from "node:assert/strict";
import { executeRender } from "../src/render/rendering.js";
import { inspectPoint, hitPoint } from "../src/inspection/point-inspection.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import {
  compileRecipes,
  constant,
  hilbert3DCoordinate,
} from "../src/recipes/recipes.js";
import { entropyShading } from "../src/analysis/entropy.js";
import { RenderCanvas } from "./render-canvas.js";
const data = Uint8Array.from({ length: 256 }, (_, i) => (i * 37 + i * i) % 251),
  source = new Blob([data]);
const base = {
  kind: "view",
  source,
  sourceId: 1,
  offset: 16,
  length: 16,
  columns: 128,
  rows: 128,
  region: "linear",
  shaders: ["entropy", "brightness"],
  configuration: presetConfiguration("linear"),
  sampleLayout: { columns: 4, rows: 4 },
};
async function rendered(job = base) {
  const cache = {};
  await executeRender(new RenderCanvas(), job, cache);
  return cache;
}
function location(cache, i = 0) {
  const p = cache.pointRaster.projected;
  return [p[i * 4], p[i * 4 + 1]];
}
let cache = await rendered(),
  info = await inspectPoint(base, cache, ...location(cache, 5));
assert.equal(info.point.index, 5);
assert.equal(info.point.sourceOffset, 21);
assert.equal(info.point.byteValue, data[21]);
assert.deepEqual(info.rendering.rgba, [
  ...cache.preparedPoints.colors.subarray(20, 24),
]);
const value = info.nodes.find(
  (node) => node.op === "factor" && node.name === "value",
);
assert.equal(value.source.sourceOffset, 21);
assert.equal(value.source.value, data[21]);
const entropy = info.nodes.find(
  (node) => node.op === "factor" && node.name === "entropy",
);
assert.equal(entropy.source.window, 32);
assert.deepEqual(entropy.source.sourceRange, { start: 5, endExclusive: 37 });
assert.equal(entropy.value, Math.fround(entropyShading(data)[21] / 255));
assert(
  info.traits.some(
    (trait) => trait.name === "Hue" && trait.expression === "entropy",
  ),
);
assert.equal(await inspectPoint(base, cache, -1, 0), null);
assert.equal(await inspectPoint(base, cache, NaN, 0), null);
assert.equal(
  await inspectPoint(base, cache, ...location(cache), () => false),
  null,
);

// Averaged samples report the interval/mean rather than pretending to be one byte.
const average = {
  ...base,
  length: 64,
  configuration: { ...base.configuration, sampleLimit: 4 },
  sampleLayout: { columns: 2, rows: 2 },
};
cache = await rendered(average);
info = await inspectPoint(average, cache, ...location(cache));
const mean = data.slice(16, 32).reduce((sum, value) => sum + value, 0) / 16;
const averagedValue = info.nodes.find(
  (node) => node.op === "factor" && node.name === "value",
);
assert.equal(averagedValue.source.meanByteValue, mean);
assert.equal(averagedValue.source.sampleCount, 16);
assert.deepEqual(averagedValue.source.sourceRange, {
  start: 16,
  endExclusive: 32,
});
assert.equal(
  info.nodes.find((node) => node.name === "entropy").source.sampleCount,
  16,
);

// A DFT bin reports its true ordinal/coefficient, independent of byte correspondence.
const dft = {
  ...base,
  region: "dft",
  configuration: presetConfiguration("dft"),
  length: 32,
  sampleLayout: { columns: 8, rows: 8 },
};
cache = await rendered(dft);
let hit = -1;
for (let i = 0; i < cache.preparedPoints.size; i++) {
  const [x, y] = location(cache, i),
    candidate = hitPoint(
      cache.preparedPoints,
      cache.pointRaster.projection,
      x,
      y,
    );
  if (candidate >= 0) {
    hit = candidate;
    break;
  }
}
assert(hit >= 0);
info = await inspectPoint(dft, cache, ...location(cache, hit));
const bin = info.point.bin.bin;
assert.equal(bin, info.point.index);
assert.equal(info.point.bin.real, cache.factorSpectrum.real[bin]);
assert.equal(info.point.bin.imaginary, cache.factorSpectrum.imaginary[bin]);
assert.equal(info.point.bin.cyclesPerByte, bin / 32);
assert.equal(info.point.bin.length, 32);
assert(
  info.nodes.some(
    (node) =>
      node.name === "amplitude" && node.source.peakAmplitude !== undefined,
  ),
);

// One point can mix a byte lookup, named arithmetic, custom entropy and spectrum lookup.
const lookup = {
  op: "byte",
  offset: { op: "add", a: { op: "offset" }, b: constant(2) },
};
const mixed = {
  ...base,
  configuration: {
    ...base.configuration,
    recipes: { neighbor: { op: "normalize", input: lookup, min: 0, max: 255 } },
  },
  appearance: {
    ...defaultAppearance("linear"),
    lightness: { op: "ref", name: "neighbor" },
    hue: { op: "entropy", offset: { op: "offset" }, window: 7 },
    opacity: { op: "spectrum", kind: "amplitude", input: constant(0) },
  },
};
cache = await rendered(mixed);
info = await inspectPoint(mixed, cache, ...location(cache, 3));
assert(
  info.nodes.some(
    (node) =>
      node.op === "byte" &&
      node.source.sourceOffset === 21 &&
      node.source.value === data[21] &&
      !("normalization" in node.source),
  ),
);
assert(
  info.nodes.some(
    (node) =>
      node.op === "entropy" &&
      node.source.window === 7 &&
      node.source.bytes.length === 7,
  ),
);
assert(
  info.nodes.some(
    (node) =>
      node.op === "spectrum" &&
      node.source.bin === 0 &&
      node.source.real !== undefined,
  ),
);
assert(
  info.traits.some(
    (trait) =>
      trait.name === "Lightness" && trait.expression.name === "neighbor",
  ),
);

// Tuple points retain first occurrence provenance and exact full-selection count factors.
const tupleSource = new Blob([Uint8Array.from([99, 1, 2, 1, 2, 1, 2, 88])]);
for (const population of ["pairs", "triples"]) {
  const job = {
    ...base,
    source: tupleSource,
    sourceId: 2,
    offset: 1,
    length: 6,
    configuration: { ...presetConfiguration("linear"), population },
    appearance: {
      ...defaultAppearance("linear"),
      opacity: population === "pairs" ? "pairCount" : "tripleCount",
    },
    sampleLayout: { columns: 8, rows: 1 },
  };
  cache = await rendered(job);
  info = await inspectPoint(job, cache, ...location(cache));
  assert.equal(info.point.sourceOffset, 1);
  assert.equal(info.point.representative, "first occurrence");
  assert.deepEqual(
    info.point.tuple,
    population === "pairs" ? [1, 2] : [1, 2, 1],
  );
  const count = info.nodes.find(
    (node) =>
      node.name === (population === "pairs" ? "pairCount" : "tripleCount"),
  );
  assert.equal(count.source.occurrences, population === "pairs" ? 3 : 2);
}

// A displayed snapshot can be inspected after its owner's render cache has moved to another window.
cache = await rendered();
const old = await inspectPoint(base, cache, ...location(cache, 5));
await executeRender(new RenderCanvas(), { ...base, offset: 64 }, cache);
const restored = await inspectPoint(base, cache, 48, 48);
assert.equal(restored.point.sourceOffset, old.point.sourceOffset);

// Hidden/truncated geometry and actual mark coverage govern picking, not nearest-point distance.
const prepared = {
  size: 2,
  shape: "circle",
  sizes: new Float32Array([1, 1]),
  colors: Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 128]),
};
const projection = {
  width: 32,
  height: 32,
  spatial: true,
  cellWidth: 1,
  cellHeight: 1,
  order: Uint32Array.from([0, 1]),
  projected: Float32Array.from([10, 10, 0, 4, 10, 10, 1, 4]),
};
assert.equal(hitPoint(prepared, projection, 10, 10), 1);
assert.equal(hitPoint(prepared, projection, 6, 6), -1);
prepared.colors[7] = 0;
assert.equal(hitPoint(prepared, projection, 10, 10), 0);

// Tracing uses the normal evaluator's float32/index rules, including vectors and exact indices.
const program = compileRecipes({
    x: hilbert3DCoordinate(0),
    y: { op: "normalize", input: lookup, min: 0, max: 255 },
  }),
  nodes = [];
const factors = new Float64Array(program.factorCount),
  traced = new Float64Array(program.factorCount);
const context = {
  offset: 2 ** 24,
  pointIndex: 2 ** 24,
  pointCount: 2 ** 30,
  length: 2 ** 24 + 10,
  byte: (index) => index % 256,
};
program.createEvaluator()(factors, context);
program.createEvaluator((node, value) => nodes.push({ node, value }))(
  traced,
  context,
);
assert.deepEqual(traced, factors);
assert(
  nodes.some(
    ({ node, value }) => node.op === "hilbert3d" && value.length === 3,
  ),
);
assert.equal(nodes.find(({ node }) => node.op === "offset").value, 2 ** 24);

// Source identity remains correct for low-level callers without engine-assigned IDs.
const plainJob = { ...base, sourceId: undefined },
  plainCache = await rendered(plainJob);
const other = {
  ...plainJob,
  source: new Blob([new Uint8Array(256).fill(255)]),
};
const replaced = await inspectPoint(other, plainCache, 48, 48);
assert.equal(replaced.point.byteValue, 255);
// Text has its own source association, even when it is the only active byte-derived trait.
const textJob = {
  ...base,
  shaders: ["hex"],
  appearance: { ...defaultAppearance("linear", []), lightness: "none" },
};
const textCache = await rendered(textJob),
  textInfo = await inspectPoint(textJob, textCache, ...location(textCache, 5));
assert.equal(
  textInfo.traits.find((trait) => trait.name === "Text").value,
  data[21].toString(16).padStart(2, "0").toUpperCase(),
);
assert.equal(
  textInfo.nodes.find((node) => node.name === "value").source.sourceOffset,
  21,
);

// UTF-8 interpretation is rooted in real bytes, even if a selection cuts a scalar.
const unicodeSource = new Blob([new TextEncoder().encode("Aé€😀Z")]);
for (let offset = 0; offset < unicodeSource.size; offset++) {
  const unicodeJob = {
    ...base,
    source: unicodeSource,
    sourceId: undefined,
    offset,
    length: 1,
    shaders: [],
    appearance: defaultAppearance("linear", []),
    sampleLayout: { columns: 1, rows: 1 },
  };
  const unicodeCache = await rendered(unicodeJob);
  const unicode = await inspectPoint(
    unicodeJob,
    unicodeCache,
    ...location(unicodeCache),
  );
  const interpretation = unicode.point.utf8;
  assert.equal(interpretation.sourceOffset, offset);
  assert.equal(interpretation.relationship, "source byte");
  assert(interpretation.sourceRange.start <= offset);
  assert(interpretation.sourceRange.endExclusive > offset);
  if (offset >= 6 && offset < 10) {
    assert.equal(interpretation.codePoint, "U+1F600");
    assert.equal(interpretation.byteIndex, offset - 6);
    assert.deepEqual(interpretation.bytes, [0xf0, 0x9f, 0x98, 0x80]);
  }
}
for (const population of ["bytes", "pairs", "bins"]) {
  const relatedJob = {
    ...base,
    source: new Blob([new Uint8Array(32).fill(65)]),
    sourceId: undefined,
    offset: 0,
    length: 32,
    configuration: { ...base.configuration, population, sampleLimit: 4 },
    sampleLayout: { columns: 2, rows: 2 },
  };
  const relatedCache = await rendered(relatedJob);
  const related = await inspectPoint(
    relatedJob,
    relatedCache,
    ...location(relatedCache),
  );
  const origin = related.point.byteCorrespondence || related.point;
  assert.equal(origin.utf8.scalar, 65);
  assert.equal(
    origin.utf8.relationship,
    {
      bytes: "sample representative byte",
      pairs: "first occurrence byte",
      bins: "byte correspondence",
    }[population],
  );
  if (population === "bins") assert.equal(related.point.utf8, undefined);
}
let unicodeCurrent = true;
const staleSource = {
  size: unicodeSource.size,
  slice(start, end) {
    return {
      async arrayBuffer() {
        const bytes = await unicodeSource.slice(start, end).arrayBuffer();
        if (end - start === 7) unicodeCurrent = false;
        return bytes;
      },
    };
  },
};
const staleUnicodeJob = {
  ...base,
  source: staleSource,
  sourceId: undefined,
  offset: 6,
  length: 1,
  shaders: [],
  appearance: defaultAppearance("linear", []),
  sampleLayout: { columns: 1, rows: 1 },
};
const staleUnicodeCache = await rendered(staleUnicodeJob);
assert.equal(
  await inspectPoint(
    staleUnicodeJob,
    staleUnicodeCache,
    ...location(staleUnicodeCache),
    () => unicodeCurrent,
  ),
  null,
);

console.log(
  "Inspection checks pass: byte/index, averaging, entropy halos, DFT coefficients, mixed/named recipes, tuple counts, old frames, hit coverage, exact trace parity, bounded UTF-8 and stale decoding.",
);
