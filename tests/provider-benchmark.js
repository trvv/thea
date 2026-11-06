// Non-gating provider report. Timings are observations, never pass/fail thresholds.
import { executeRender } from "../src/render/rendering.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { RenderCanvas } from "./render-canvas.js";

let seed = 123;
const random = Uint8Array.from({ length: 2 ** 20 }, () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed & 255;
});
const source = new Blob([random]);
const repeated = new Blob([
  Uint8Array.from({ length: random.length }, (_, i) => i % 4),
]);
const appearance = { ...defaultAppearance("linear"), lightness: "value" };
const base = {
  kind: "view",
  source,
  sourceId: 1,
  offset: 0,
  length: 65536,
  columns: 128,
  rows: 96,
  region: "linear",
  shaders: [],
  diagnostics: true,
  configuration: {
    ...presetConfiguration("linear"),
    sampling: "representative",
    sampleLimit: 256,
  },
  sampleLayout: { columns: 16, rows: 16 },
  appearance,
};
const fixtures = [
  ["sparse-entropy-64K", base],
  ["sparse-entropy-1M", { ...base, length: random.length }],
  [
    "multiple-entropy-windows",
    {
      ...base,
      appearance: {
        ...appearance,
        hue: { op: "entropy", offset: { op: "offset" }, window: 16 },
        lightness: { op: "entropy", offset: { op: "offset" }, window: 256 },
      },
    },
  ],
  [
    "random-pairs",
    {
      ...base,
      configuration: { ...base.configuration, population: "pairs" },
      appearance: { ...appearance, lightness: "pairCount" },
    },
  ],
  [
    "repeated-triples",
    {
      ...base,
      source: repeated,
      configuration: { ...base.configuration, population: "triples" },
      appearance: { ...appearance, lightness: "tripleCount" },
    },
  ],
  [
    "random-triples",
    {
      ...base,
      configuration: { ...base.configuration, population: "triples" },
      appearance: { ...appearance, lightness: "tripleCount" },
    },
  ],
  [
    "FFT-radix2",
    {
      ...base,
      length: 4096,
      appearance: { ...appearance, hue: "phase", lightness: "amplitude" },
    },
  ],
  [
    "FFT-prime",
    {
      ...base,
      length: 4093,
      appearance: { ...appearance, hue: "phase", lightness: "amplitude" },
    },
  ],
];
console.log(
  "CPU/canvas-double provider report; excludes transport/presentation, transient FFT memory, and object/Map byte overhead. Provider and source times overlap.",
);
for (const [name, job] of fixtures) {
  const canvas = new RenderCanvas(),
    cache = {};
  for (const mode of ["cold", "warm", "appearance"]) {
    const changed =
      mode === "appearance"
        ? { ...job, appearance: { ...job.appearance, saturation: "value" } }
        : job;
    const result = await executeRender(canvas, changed, cache);
    console.log(
      JSON.stringify({
        fixture: name,
        mode,
        duration: result.duration,
        timings: result.timings,
        reused: result.reused,
        diagnostics: result.diagnostics,
      }),
    );
  }
}
