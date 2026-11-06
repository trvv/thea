import assert from "node:assert/strict";
import {
  executeRender,
  entropyShading,
  hilbertCells,
  byteCharacter,
} from "../src/render/rendering.js";
import { pointFactors } from "../src/data/point-factors.js";
import { windowCounts } from "../src/analysis/histograms.js";
import { overviewValues } from "../src/render/overview.js";
import { compileRecipes, constant } from "../src/recipes/recipes.js";
import {
  presetConfiguration,
  validateConfiguration,
} from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { factorIndices as slots } from "../src/recipes/factors.js";
import { limitedSampleLayout } from "../src/data/populations.js";
import { RenderCanvas } from "./render-canvas.js";

let reads = 0;
class Source extends Blob {
  slice(...args) {
    reads++;
    return super.slice(...args);
  }
}
const bytes = Uint8Array.from(
    { length: 200000 },
    (_, i) => (i * 71 + (i >>> 3)) % 251,
  ),
  source = new Source([bytes]);
const base = {
  kind: "view",
  source,
  offset: 0,
  length: 512,
  region: "trigraph",
  columns: 64,
  rows: 48,
  width: 64,
  height: 48,
  scale: 1,
  pointScale: 1,
  sampleLayout: { columns: 32, rows: 16 },
  configuration: presetConfiguration("trigraph"),
  shaders: [],
};
const plain = {
  ...defaultAppearance("linear"),
  hue: "none",
  lightness: "none",
};

// Every incremental provider agrees with a fresh build across chunk boundaries,
// both scroll directions, resize, empty/short ranges, and source replacement.
for (const width of [1, 2, 3]) {
  const cache = {};
  for (const [offset, length] of [
    [0, 70000],
    [1, 70000],
    [97, 69998],
    [3, 70001],
    [65535, 10000],
    [65534, 10002],
    [0, 0],
    [1, 1],
    [0, 2],
    [0, 70000],
  ]) {
    const job = { source, offset, length };
    const actual = await windowCounts(job, cache, width),
      fresh = await windowCounts(job, {}, width);
    assert.deepEqual(
      actual.counts,
      fresh.counts,
      `Incremental width ${width}: ${offset}/${length}`,
    );
  }
  const old = await windowCounts(
    { source, offset: 0, length: 70000 },
    cache,
    width,
  );
  const snapshot = width === 3 ? new Map(old.counts) : old.counts.slice();
  assert.equal(
    await windowCounts(
      { source, offset: 1, length: 70000 },
      cache,
      width,
      () => false,
    ),
    null,
  );
  assert.deepEqual(
    old.counts,
    snapshot,
    "Cancelled count update mutated a committed histogram",
  );
  const next = await windowCounts(
    { source, offset: 32, length: 70000 },
    cache,
    width,
  );
  assert(
    next.bytesRead <= 64 + 2 * (width - 1),
    "Overlapping windows were fully reread",
  );
  const replacement = await windowCounts(
    { source: new Blob([new Uint8Array(70000)]), offset: 32, length: 100 },
    cache,
    width,
  );
  assert.deepEqual(
    replacement.counts,
    (
      await windowCounts(
        { source: new Blob([new Uint8Array(100)]), offset: 0, length: 100 },
        {},
        width,
      )
    ).counts,
  );
}

// Aggregated populations retain one point per tuple while arbitrary providers
// (FFT, contextual entropy, byte neighbors) remain independently mixable.
for (const population of ["pairs", "triples"]) {
  const width = population === "pairs" ? 2 : 3;
  const configuration = { ...base.configuration, population };
  const appearance = {
    ...plain,
    hue: "phase",
    opacity: "pairCount",
    size: "entropy",
  };
  const visit = await pointFactors(
    { ...base, configuration },
    appearance,
    {},
    () => true,
  );
  const seen = new Set(),
    expected = new Map();
  for (let i = 0; i + width <= base.length; i++) {
    const key = [...bytes.subarray(i, i + width)].join("/");
    if (!expected.has(key)) expected.set(key, i);
  }
  visit((values, label, context) => {
    const key = [
      ...bytes.subarray(context.offset, context.offset + width),
    ].join("/");
    assert(!seen.has(key));
    seen.add(key);
    assert.equal(context.offset, expected.get(key));
    assert(Number.isFinite(values[slots.phase]));
  });
  assert.equal(seen.size, expected.size);
}
const spectrumJob = {
  ...base,
  region: "dft",
  configuration: presetConfiguration("dft"),
};
let binPoints = 0;
(await pointFactors(spectrumJob, plain, {}, () => true))((values) => {
  assert.equal(values[slots.frequency], (2 * binPoints) / base.length);
  binPoints++;
});
assert.equal(binPoints, base.length / 2 + 1);

const limited = {
  ...base,
  configuration: { ...presetConfiguration("linear"), sampleLimit: 7 },
  length: 512,
};
let samples = 0,
  lastOffset;
(await pointFactors(limited, plain, {}, () => true))(
  (values, label, context) => {
    samples++;
    lastOffset = context.offset;
  },
);
assert.equal(samples, 7);
assert(lastOffset > 400);
assert.equal(limited.length, 512);
assert(
  limitedSampleLayout(
    { columns: 10000, rows: 10000, length: 100000000 },
    limited.configuration,
  ).columns *
    limitedSampleLayout({ columns: 10000, rows: 10000 }, limited.configuration)
      .rows <=
    7,
);
assert.throws(() =>
  validateConfiguration({ ...limited.configuration, sampleLimit: 0 }),
);
assert.throws(() =>
  validateConfiguration({ ...limited.configuration, population: "unknown" }),
);

// Both CPU precision and emitted shader precision have dedicated large-offset
// checks; this fixture allocates no giant byte buffer.
const neighbor = {
  op: "byte",
  offset: { op: "add", a: { op: "offset" }, b: constant(1) },
};
const program = compileRecipes({
  x: { op: "normalize", input: neighbor, min: 0, max: 255 },
});
const factors = new Float64Array(program.factorCount);
let accessed;
program.createEvaluator()(factors, {
  offset: 2 ** 24,
  length: 2 ** 24 + 100,
  byte: (index) => {
    accessed = index;
    return index % 256;
  },
});
assert.equal(accessed, 2 ** 24 + 1);
assert.equal(program.nodes.find((node) => node.op === "add").type, "index");

// Equivalent expression syntax cannot change footprint or raster output.
const grid = {
  ...base,
  region: "linear",
  configuration: presetConfiguration("linear"),
  appearance: { ...plain, lightness: "value" },
};
const a = new RenderCanvas(),
  b = new RenderCanvas(),
  cache = {};
await executeRender(a, grid, cache);
const raster = cache.pointRaster,
  projections = raster.projected;
await executeRender(a, grid, cache);
assert.equal(cache.pointRaster, raster);
assert.equal(raster.projected, projections);
const prepared = cache.preparedPoints;
await executeRender(
  a,
  { ...grid, configuration: { ...grid.configuration, backend: "webgl" } },
  cache,
);
assert.equal(
  cache.preparedPoints,
  prepared,
  "Backend change repeated point preparation",
);
// The canvas double has no GPU context, so capability fallback must produce the reference pixels.
assert.equal(cache.pointBackend, "cpu");
await executeRender(b, {
  ...grid,
  configuration: {
    ...grid.configuration,
    position: [
      { op: "factor", name: "column" },
      { op: "factor", name: "row" },
      "none",
    ],
  },
});
assert.deepEqual(a.pixels, b.pixels);

// Presentation-only DFT changes reuse coefficients and source reads.
const presetJob = { ...base, configuration: undefined, region: "dft" };
const dftCache = {};
await executeRender(a, presetJob, dftCache);
const spectrum = dftCache.factorSpectrum,
  before = reads;
await executeRender(a, { ...presetJob, columns: 32, rows: 24 }, dftCache);
assert.equal(reads, before);
assert.equal(dftCache.factorSpectrum, spectrum);
await executeRender(
  a,
  { ...presetJob, configuration: presetConfiguration("dft") },
  dftCache,
);
assert.equal(dftCache.factorSpectrum, spectrum);
await executeRender(a, { ...presetJob, length: 513 }, dftCache);
assert.equal(dftCache.factorSpectrum.real.length, 257);
assert.equal(
  dftCache.factorSpectrum.real.buffer.byteLength,
  257 * 8,
  "Spectrum cache retained padded FFT backing storage",
);

// A source wider than the detailed LRU retains coarse totals, and unchanged
// overview rasters do no reads regardless of source size.
const large = new Source([new Uint8Array(8 * 1024 * 1024)]),
  overviewCache = {};
await overviewValues({ source: large, width: 1, height: 1 }, overviewCache);
const coarse = await overviewValues(
  { source: large, width: 2, height: 1 },
  overviewCache,
);
assert.equal(coarse.bytesRead, 0);
assert(overviewCache.overview.pages.size <= 64);
const warm = await overviewValues(
  { source: large, width: 2, height: 1 },
  overviewCache,
);
assert.equal(warm.bytesRead, 0);
console.log(
  "Pipeline checks pass: mixed populations, sample budgets, incremental providers, cancellation, exact indices, scratch reuse, spectrum reuse, large overview summaries.",
);
