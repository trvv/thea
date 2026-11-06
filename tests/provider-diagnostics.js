import assert from "node:assert/strict";
import { executeRender, renderCost } from "../src/render/rendering.js";
import { RenderEngine } from "../src/render/render-engine.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import {
  createProviderDiagnostics,
  retainedProviderStorage,
  retainedRenderStorage,
} from "../src/data/provider-diagnostics.js";
import { windowCounts } from "../src/analysis/histograms.js";
import { RenderCanvas } from "./render-canvas.js";

const bytes = Uint8Array.from({ length: 256 }, (_, i) => (i * 17) % 251);
const source = new Blob([bytes]);
const job = {
  kind: "view",
  source,
  sourceId: 1,
  offset: 16,
  length: 64,
  columns: 16,
  rows: 16,
  region: "linear",
  shaders: [],
  configuration: { ...presetConfiguration("linear"), sampleLimit: 16 },
  sampleLayout: { columns: 4, rows: 4 },
  appearance: {
    ...defaultAppearance("linear"),
    hue: "entropy",
    lightness: "value",
  },
  diagnostics: true,
};
const canvas = new RenderCanvas(),
  cache = {};
const cold = await executeRender(canvas, job, cache);
assert.equal(cold.diagnostics.source.reads, 1);
assert.equal(cold.diagnostics.source.bytes, 95);
assert.equal(cold.diagnostics.providers.bytes.rebuilds, 1);
assert.equal(cold.diagnostics.providers["entropy:32:quantized"].rebuilds, 1);
assert.equal(cold.diagnostics.evaluation.samples, 16);
assert.equal(cold.diagnostics.preparationReused, false);
assert.equal(cold.diagnostics.retained.typedArrayBytes, 95 + 95 + 64 * 4);
for (const metric of Object.values(cold.diagnostics.providers))
  assert(Number.isFinite(metric.milliseconds) && metric.milliseconds >= 0);
assert.deepEqual(
  JSON.parse(JSON.stringify(cold.diagnostics)),
  cold.diagnostics,
);
const pixels = canvas.pixels.slice();
const plain = await executeRender(canvas, { ...job, diagnostics: false }, {});
assert(!Object.hasOwn(plain, "diagnostics"));
assert.deepEqual(canvas.pixels, pixels, "Diagnostics changed pixels");
const warm = await executeRender(canvas, job, cache);
assert.equal(warm.diagnostics.preparationReused, true);
assert.equal(warm.diagnostics.source.reads, 0);
assert.equal(warm.diagnostics.evaluation.samples, 0);
assert.deepEqual(warm.diagnostics.providers, {});
assert.deepEqual(warm.diagnostics.retained, cold.diagnostics.retained);
const appearance = await executeRender(
  canvas,
  {
    ...job,
    appearance: { ...job.appearance, saturation: "value" },
  },
  cache,
);
assert(appearance.reused.geometry);
assert.equal(appearance.diagnostics.providers.bytes.hits, 1);
assert.equal(appearance.diagnostics.providers["entropy:32:quantized"].hits, 1);
assert.equal(appearance.diagnostics.source.reads, 0);

const twoWindows = {
  ...job,
  appearance: {
    ...job.appearance,
    hue: { op: "entropy", offset: { op: "offset" }, window: 16 },
    lightness: { op: "entropy", offset: { op: "offset" }, window: 64 },
  },
};
const multiple = await executeRender(canvas, twoWindows, {});
assert.equal(multiple.diagnostics.providers["entropy:16"].rebuilds, 1);
assert.equal(multiple.diagnostics.providers["entropy:64"].rebuilds, 1);
assert(!multiple.diagnostics.providers["entropy:32:quantized"]);
const spectral = {
  ...job,
  appearance: { ...job.appearance, hue: "phase", lightness: "amplitude" },
};
const spectraCache = {};
const spectrum = await executeRender(canvas, spectral, spectraCache);
assert.equal(spectrum.diagnostics.providers.spectrum.rebuilds, 1);
assert.equal(spectrum.diagnostics.providers["spectrum:components"].rebuilds, 1);
const extra = await executeRender(
  canvas,
  {
    ...spectral,
    appearance: { ...spectral.appearance, saturation: "value" },
  },
  spectraCache,
);
assert.equal(extra.diagnostics.providers.spectrum.hits, 1);
assert.equal(extra.diagnostics.providers["spectrum:components"].hits, 1);
assert.equal(extra.diagnostics.source.bytes, 0);

const buffer = new ArrayBuffer(128),
  view = new Uint8Array(buffer),
  counts = new Map([[123, 5]]);
assert.deepEqual(
  retainedProviderStorage({
    factorWindow: { data: view.subarray(5) },
    factorEntropy: { values: view },
    factorCounts: { triple: counts },
    trigraph: { counts },
    factorSpectrum: { real: new Float64Array(buffer, 0, 8) },
  }),
  { typedArrayBytes: 128, buffers: 1, views: 3, mapEntries: 1 },
);

const histogramSource = new Blob([new Uint8Array(140000)]),
  histogramCache = {};
const histogramJob = {
  ...job,
  source: histogramSource,
  offset: 0,
  length: 140000,
};
const histogramMetrics = createProviderDiagnostics(job);
await windowCounts(
  histogramJob,
  histogramCache,
  2,
  () => true,
  undefined,
  histogramMetrics,
);
assert.equal(histogramMetrics.source.reads, 3);
assert.equal(histogramMetrics.source.bytes, 140000);
const histogramWarm = createProviderDiagnostics(job);
await windowCounts(
  histogramJob,
  histogramCache,
  2,
  () => true,
  undefined,
  histogramWarm,
);
assert.equal(histogramWarm.source.reads, 0);
const increment = createProviderDiagnostics(job);
await windowCounts(
  { ...histogramJob, offset: 1, length: 139998 },
  histogramCache,
  2,
  () => true,
  undefined,
  increment,
);
assert(increment.source.reads > 0 && increment.source.bytes < 16);

// Custom providers are already included in structural routing through requiredFactors.
const constantAppearance = {
  ...job.appearance,
  hue: "none",
  lightness: "none",
};
const cheap = { ...job, appearance: constantAppearance };
assert(renderCost(twoWindows) > renderCost(cheap));
assert(renderCost(spectral) > renderCost(cheap));

const localEngine = new RenderEngine(new RenderCanvas());
localEngine.supported = false;
let localFrame;
localEngine.onFrame = (frame) => {
  localFrame = frame;
};
assert(await localEngine.render(job));
assert.equal(localFrame.diagnostics.source.reads, 1);
assert.deepEqual(localFrame.diagnostics.retained, cold.diagnostics.retained);
localEngine.cancel();

// Exercise actual worker protocol and frame callbacks, including diagnostics enabled after a warm frame.
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
const frames = [];
engine.onFrame = (frame) => frames.push(frame);
const deadline = setTimeout(() => {
  engine.cancel();
  throw new Error("Diagnostics worker did not finish");
}, 10000);
try {
  assert(await engine.render({ ...job, diagnostics: false }));
  assert(!Object.hasOwn(frames.at(-1), "diagnostics"));
  assert(await engine.render(job));
  assert.equal(frames.at(-1).diagnostics.preparationReused, true);
  assert.equal(frames.at(-1).diagnostics.source.bytes, 0);
  assert(frames.at(-1).diagnostics.retained.typedArrayBytes > 0);
  assert(await engine.render({ ...job, offset: 17 }));
  assert.equal(frames.at(-1).diagnostics.source.reads, 1);
} finally {
  clearTimeout(deadline);
  engine.cancel();
}
console.log(
  "Provider diagnostics pass: opt-in pixel parity, exact reads, cold/warm reuse, multiple windows, FFT/components, deduplicated storage, histogram deltas and real worker callbacks.",
);

const aliasedBuffer = new Float32Array(32);
const aliasedCache = {
  factorWindow: { data: aliasedBuffer },
  preparedPoints: { positions: aliasedBuffer },
  pointCompute: { uploadedProviders: [aliasedBuffer] },
};
assert.equal(
  retainedRenderStorage(aliasedCache).knownRetainedTypedArrayBytes,
  aliasedBuffer.byteLength,
);
