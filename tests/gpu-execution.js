import assert from "node:assert/strict";
import { executeRender } from "../src/render/rendering.js";
import {
  presetConfiguration,
  validateConfiguration,
} from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { preparationKey, geometryKey } from "../src/render/render-identity.js";
import { RenderCanvas } from "./render-canvas.js";
const configuration = presetConfiguration("trigraph");
assert.equal(configuration.gpuRecipes, false);
assert.equal(configuration.gpuProjection, false);
for (const flag of ["gpuRecipes", "gpuProjection"]) {
  assert.throws(
    () => validateConfiguration({ ...configuration, [flag]: "yes" }),
    /boolean/,
  );
  assert.equal(
    validateConfiguration({ ...configuration, [flag]: true })[flag],
    true,
  );
}
const job = {
  kind: "view",
  source: new Blob([Uint8Array.from({ length: 1024 }, (_, i) => i & 255)]),
  sourceId: 1,
  offset: 0,
  length: 1024,
  columns: 64,
  rows: 48,
  region: "trigraph",
  shaders: [],
  configuration,
  appearance: defaultAppearance("trigraph"),
  sampleLayout: { columns: 32, rows: 32 },
};
const fallback = {
  ...job,
  configuration: { ...configuration, gpuProjection: true, gpuRecipes: true },
};
const a = new RenderCanvas(),
  b = new RenderCanvas(),
  cache = {};
await executeRender(a, job, {});
await executeRender(b, fallback, cache);
assert.deepEqual(a.pixels, b.pixels);
assert.equal(cache.recipeBackend, "cpu");
assert.equal(cache.pointRaster.projection.backend, "cpu");
const projection = {
  ...job,
  configuration: { ...configuration, gpuProjection: true },
};
assert.equal(preparationKey(job), preparationKey(projection));
assert.equal(geometryKey(job), geometryKey(projection));
assert.notEqual(preparationKey(job), preparationKey(fallback));
console.log(
  "GPU execution fallback passes: opt-in validation, unavailable context parity and dependency-specific cache identities. Executed GPU fixtures live in Chromium.",
);
