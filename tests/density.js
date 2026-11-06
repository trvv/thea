import assert from "node:assert/strict";
import { paintDensity, inspectDensity, validateDensity } from "../density.js";
import { executeRender } from "../rendering.js";
import { inspectPoint } from "../point-inspection.js";
import { RenderEngine } from "../render-engine.js";
import { presetConfiguration } from "../point-configuration.js";
import { defaultAppearance, validateAppearance } from "../appearance.js";
import { RenderCanvas } from "./render-canvas.js";

const prepared = {
  size: 2,
  colors: Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 128]),
  sizes: Float32Array.of(1, 1),
  shape: "square",
  geometry: { indices: Uint32Array.of(0, 1) },
};
const projection = {
  width: 3,
  height: 3,
  cellWidth: 2,
  cellHeight: 2,
  spatial: false,
  projected: Float32Array.from([1.5, 1.5, 0, 1, 1.5, 1.5, 0, 1]),
  order: Uint32Array.of(0, 1),
};
const canvas = new RenderCanvas();
canvas.width = canvas.height = 3;
const context = canvas.getContext("2d"),
  scratch = {},
  job = { configuration: {} };
let settings = validateDensity({});
const all = paintDensity(context, prepared, projection, scratch, settings, job);
assert.equal(scratch.density.count[4] / scratch.density.unit, 2);
assert.equal(scratch.density.covered, null);
assert.ok(scratch.density.sorted instanceof Uint32Array);
assert.equal(all.referenceValue, 2);
assert.deepEqual([...canvas.pixels.slice(16, 20)], [128, 0, 128, 255]);
assert.equal(
  inspectDensity(prepared, projection, 1, 1, settings, all.referenceValue)
    .contributorCount,
  2,
);
settings = validateDensity({ mode: "front" });
const front = paintDensity(
  context,
  prepared,
  projection,
  scratch,
  settings,
  job,
);
assert.equal(scratch.density.count[4] / scratch.density.unit, 1);
assert.deepEqual([...canvas.pixels.slice(16, 20)], [0, 0, 255, 255]);
assert.equal(
  inspectDensity(prepared, projection, 1, 1, settings, front.referenceValue)
    .contributorCount,
  1,
);
settings = validateDensity({
  opacityWeight: true,
  reference: "fixed",
  value: 2,
});
paintDensity(context, prepared, projection, scratch, settings, job);
assert.equal(scratch.density.count[4], 1 + 128 / 255);
assert.equal(scratch.density.covered, null);
assert.equal(scratch.density.sorted, null);
const allocated = scratch.density.count;
paintDensity(context, prepared, projection, scratch, settings, job);
assert.equal(scratch.density.count, allocated);
assert.throws(
  () =>
    paintDensity(
      context,
      prepared,
      projection,
      scratch,
      validateDensity({ budget: 1 }),
      job,
    ),
  /budget/,
);
for (const invalid of [
  null,
  [],
  3,
  { mode: "none" },
  { reference: "peak" },
  { percentile: 2 },
  { value: 0 },
  { exposure: -1 },
  { budget: 0 },
])
  assert.throws(() => validateDensity(invalid));

// Independent per-probe oracle for fractional coverage, clipping, shapes and front ownership.
for (const shape of ["square", "circle"])
  for (const mode of ["all", "front"]) {
    const fixture = { ...prepared, shape, sizes: Float32Array.of(0.7, 1.2) };
    const p = {
      ...projection,
      projected: Float32Array.from([0.8, 1.2, 0, 1, 1.8, 1.7, 0, 1]),
    };
    const settings = validateDensity({ mode });
    paintDensity(context, fixture, p, scratch, settings, job);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) {
        let expected = 0;
        for (const dx of [0.25, 0.75])
          for (const dy of [0.25, 0.75]) {
            const hits = [];
            for (let i = 0; i < 2; i++) {
              const rx = (x + dx - p.projected[i * 4]) / fixture.sizes[i],
                ry = (y + dy - p.projected[i * 4 + 1]) / fixture.sizes[i];
              if (
                shape === "square"
                  ? Math.abs(rx) <= 1 && Math.abs(ry) <= 1
                  : rx * rx + ry * ry <= 1
              )
                hits.push(i);
            }
            expected +=
              (mode === "front" ? Math.min(1, hits.length) : hits.length) / 4;
          }
        assert.equal(
          scratch.density.count[y * 3 + x] / scratch.density.unit,
          expected,
        );
      }
  }

const source = new Blob([Uint8Array.of(1, 2)]);
const base = {
  kind: "view",
  source,
  offset: 0,
  length: 2,
  columns: 8,
  rows: 8,
  region: "linear",
  configuration: {
    ...presetConfiguration("linear"),
    footprint: "point",
    position: [
      { op: "constant", value: 0.5 },
      { op: "constant", value: 0.5 },
      "none",
    ],
  },
  appearance: {
    ...defaultAppearance("linear", []),
    hue: "none",
    density: validateDensity({}),
  },
  sampleLayout: { columns: 2, rows: 1 },
  shaders: [],
};
const cache = {};
await executeRender(new RenderCanvas(), base, cache);
const info = await inspectPoint(base, cache, 4, 4);
assert.equal(info.rendering.accumulation.contributorCount, 2);
assert.equal(info.rendering.accumulation.coverageWeightedCount, 2);
const geometry = cache.pointGeometry;
const displayedCanvas = new RenderCanvas();
await executeRender(displayedCanvas, base, cache);
const previousPixels = displayedCanvas.pixels.slice();
const previousWidth = displayedCanvas.width;
await assert.rejects(
  executeRender(
    displayedCanvas,
    {
      ...base,
      columns: 128,
      rows: 128,
      appearance: { ...base.appearance, density: { mode: "all", budget: 1 } },
    },
    cache,
  ),
  /budget/,
);
assert.equal(displayedCanvas.width, previousWidth);
assert.deepEqual(displayedCanvas.pixels, previousPixels);
await executeRender(
  new RenderCanvas(),
  {
    ...base,
    appearance: {
      ...base.appearance,
      density: validateDensity({ mode: "front" }),
    },
  },
  cache,
);
assert.equal(cache.pointGeometry, geometry);
assert.deepEqual(
  validateAppearance("linear", JSON.parse(JSON.stringify(base.appearance))),
  base.appearance,
);

// Keep the exact displayed reference across a real worker inspection.
const engine = new RenderEngine(new RenderCanvas(), {
  budget: 0,
  workerFactory: () => {
    const worker = new Worker(new URL("./render-thread.js", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", ({ data }) => {
      if (data.bitmap) data.bitmap.close = () => {};
    });
    return worker;
  },
});
const deadline = setTimeout(() => {
  engine.cancel();
  throw Error("Density worker timed out");
}, 10000);
try {
  assert(await engine.render(base));
  const inspected = await engine.inspect(4, 4);
  assert.equal(inspected.rendering.accumulation.reference, 2);
  assert.equal(inspected.rendering.accumulation.contributorCount, 2);
} finally {
  clearTimeout(deadline);
  engine.cancel();
}
console.log(
  "Density passes: all/front flags, per-probe oracle, clipping/shapes/opacity, exact buffers and budgets, profile parity, aggregate inspection and real worker reference.",
);
