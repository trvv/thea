import assert from "node:assert/strict";
import { executeRender } from "../src/render/rendering.js";
import { pointFactors } from "../src/data/point-factors.js";
import { inspectPoint } from "../src/inspection/point-inspection.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { factorIndices } from "../src/recipes/factor-catalog.js";
import { RenderCanvas } from "./render-canvas.js";

const data = Uint8Array.from(
  { length: 2 ** 20 + 128 },
  (_, i) => (i * 37 + (i >>> 4)) % 251,
);
const source = new Blob([data]);
const offset = { op: "offset" };
const read = (delta) => ({
  op: "byte",
  offset: { op: "add", a: offset, b: { op: "constant", value: delta } },
});
const base = {
  kind: "view",
  source,
  offset: 0,
  length: 2 ** 20,
  columns: 128,
  rows: 96,
  region: "linear",
  shaders: [],
  diagnostics: true,
  configuration: {
    ...presetConfiguration("linear"),
    sampling: "representative",
    sampleLimit: 8,
  },
  sampleLayout: { columns: 4, rows: 2 },
  appearance: { ...defaultAppearance("linear"), lightness: "value" },
};

async function compare(job) {
  const sparseCanvas = new RenderCanvas(),
    denseCanvas = new RenderCanvas();
  const sparseCache = {},
    denseCache = {};
  const sparse = await executeRender(sparseCanvas, job, sparseCache);
  const dense = await executeRender(
    denseCanvas,
    { ...job, sparseProviders: false },
    denseCache,
  );
  assert(sparseCache.factorSparse, "Expected sparse preparation");
  assert(
    !sparseCache.factorWindow &&
      !sparseCache.factorEntropy &&
      !sparseCache.recipeEntropy,
  );
  assert.deepEqual(
    sparseCanvas.pixels,
    denseCanvas.pixels,
    "Sparse preparation changed pixels",
  );
  assert(sparse.diagnostics.source.bytes < dense.diagnostics.source.bytes / 2);
  assert(
    sparse.diagnostics.retained.typedArrayBytes <
      dense.diagnostics.retained.typedArrayBytes / 2,
  );
  return { sparse, sparseCache, sparseCanvas };
}

for (const start of [0, 19, 128]) {
  for (const window of [1, 7, 32, 33, 256, 4096]) {
    await compare({
      ...base,
      offset: start,
      appearance: {
        ...base.appearance,
        hue: { op: "entropy", offset, window },
        saturation: { op: "normalize", input: read(-1), min: 0, max: 255 },
        size: { op: "normalize", input: read(2), min: 0, max: 255 },
      },
    });
  }
}
const shared = await compare({
  ...base,
  appearance: {
    ...base.appearance,
    hue: { op: "entropy", offset, window: 7 },
    lightness: { op: "entropy", offset, window: 32 },
    opacity: { op: "entropy", offset, window: 256 },
  },
});
const warm = await executeRender(
  shared.sparseCanvas,
  {
    ...base,
    appearance: {
      ...base.appearance,
      hue: { op: "entropy", offset, window: 7 },
      lightness: { op: "entropy", offset, window: 32 },
      opacity: { op: "entropy", offset, window: 256 },
    },
  },
  shared.sparseCache,
);
assert.equal(warm.diagnostics.source.reads, 0);

const inspection = await compare(base);
const projection = inspection.sparseCache.pointRaster.projected;
const info = await inspectPoint(
  base,
  inspection.sparseCache,
  projection[0],
  projection[1],
);
assert.equal(info.point.byteValue, data[0]);
assert.equal(
  info.nodes.find((node) => node.name === "entropy").source.bytes.length,
  16,
);
assert.equal(
  info.nodes.find((node) => node.name === "value").source.value,
  data[0],
);

// Exact origin arithmetic remains safe beyond adjacent float32 integer addresses.
const synthetic = {
  size: 2 ** 26,
  slice(start, end) {
    return new Blob([
      Uint8Array.from({ length: end - start }, (_, i) => (start + i) % 251),
    ]);
  },
};
const exactJob = {
  ...base,
  source: synthetic,
  length: 2 ** 25 + 1,
  configuration: { ...base.configuration, sampleLimit: 4 },
  sampleLayout: { columns: 2, rows: 2 },
  appearance: {
    ...defaultAppearance("linear", []),
    lightness: { op: "normalize", input: read(1), min: 0, max: 255 },
  },
};
const exactCache = {};
const visit = await pointFactors(
  exactJob,
  exactJob.appearance,
  exactCache,
  () => true,
);
assert(exactCache.factorSparse);
visit((factors, label, context) => {
  assert.equal(context.byte(context.offset + 1), (context.offset + 1) % 251);
  assert.equal(factors[factorIndices.value], (context.offset % 251) / 255);
});

// Full-bucket averaging and data-dependent lookup addresses retain the dense reference.
for (const job of [
  { ...base, configuration: { ...base.configuration, sampling: "average" } },
  {
    ...base,
    appearance: {
      ...base.appearance,
      hue: {
        op: "normalize",
        input: { op: "byte", offset: read(0) },
        min: 0,
        max: 255,
      },
    },
  },
  { ...base, appearance: { ...base.appearance, hue: "byteCount" } },
]) {
  const cache = {};
  const canvas = new RenderCanvas(),
    reference = new RenderCanvas();
  await executeRender(canvas, job, cache);
  await executeRender(reference, { ...job, sparseProviders: false }, {});
  assert(!cache.factorSparse);
  assert(cache.factorWindow);
  assert.deepEqual(canvas.pixels, reference.pixels);
}

// A rejected or superseded request cannot publish a partially read sparse cache.
let reads = 0,
  current = true;
const canceledSource = {
  size: source.size,
  slice(start, end) {
    reads++;
    return {
      async arrayBuffer() {
        current = false;
        return source.slice(start, end).arrayBuffer();
      },
    };
  },
};
const canceledCache = {};
assert.equal(
  await pointFactors(
    { ...base, source: canceledSource },
    base.appearance,
    canceledCache,
    () => current,
  ),
  null,
);
assert.equal(reads, 1);
assert(!canceledCache.factorSparse);
reads = 0;
await assert.rejects(
  () =>
    pointFactors(
      {
        ...base,
        source: canceledSource,
        configuration: { ...base.configuration, providerBudget: 1 },
      },
      base.appearance,
      {},
      () => true,
    ),
  /budget/,
);
assert.equal(reads, 0);

console.log(
  "Sparse provider checks pass: dense pixel parity, odd/even/root-edge windows, shared halos, inspection, exact indices, warm reuse, averaged/data-dependent fallbacks, bounded storage and cancellation.",
);
