import assert from "node:assert/strict";
import {
  localFrame,
  prepareLocalSpectra,
  spectralFrameStart,
} from "../local-spectrum.js";
import { analysisParameters } from "../analysis-parameters.js";
import { compileRecipes } from "../recipes.js";
import { pointFactors } from "../point-factors.js";
import { presetConfiguration } from "../point-configuration.js";
import { defaultAppearance } from "../appearance.js";

const direct = (samples) => {
  const real = [],
    imaginary = [];
  for (let bin = 0; bin < samples.length; bin++) {
    let re = 0,
      im = 0;
    for (let i = 0; i < samples.length; i++) {
      re += samples[i] * Math.cos((2 * Math.PI * bin * i) / samples.length);
      im -= samples[i] * Math.sin((2 * Math.PI * bin * i) / samples.length);
    }
    real.push(re);
    imaginary.push(im);
  }
  return { real, imaginary };
};
for (const window of [1, 2, 7, 8, 15, 16]) {
  const bytes = Uint8Array.from(
    { length: window * 2 },
    (_, i) => (i * 23) % 251,
  );
  for (const taper of ["rectangular", "hann"])
    for (const preprocessing of ["unsigned", "centered", "mean"]) {
      const parameters = analysisParameters({
        family: "spectral",
        window,
        hop: window,
        taper,
        preprocessing,
        dc: true,
      });
      const frame = localFrame(bytes, parameters, 0);
      const reference = direct(frame.samples);
      for (let bin = 0; bin < window; bin++) {
        assert(Math.abs(frame.real[bin] - reference.real[bin]) < 1e-8);
        assert(
          Math.abs(frame.imaginary[bin] - reference.imaginary[bin]) < 1e-8,
        );
      }
      const expectedPower =
        frame.samples.reduce((sum, sample) => sum + sample ** 2, 0) * window;
      assert(Math.abs(frame.result[3] - expectedPower) < 1e-7);
      if (expectedPower > 0) assert.equal(frame.result[0], 1);
    }
}
const constant = new Uint8Array(32).fill(65);
for (const window of [7, 8]) {
  assert.equal(
    localFrame(
      constant,
      analysisParameters({
        family: "spectral",
        window,
        preprocessing: "unsigned",
        dc: false,
      }),
      0,
    ).result[1],
    0,
  );
  assert.equal(
    localFrame(
      constant,
      analysisParameters({
        family: "spectral",
        window,
        preprocessing: "unsigned",
        dc: true,
        low: 0,
        high: 0,
      }),
      0,
    ).result[0],
    1,
  );
}
const periodic = Uint8Array.from(
  { length: 64 },
  (_, i) => [128, 255, 128, 1][i % 4],
);
const parameters = analysisParameters({
  family: "spectral",
  window: 16,
  hop: 8,
  low: 0.25,
  high: 0.25,
});
assert.equal(localFrame(periodic, parameters, 0).result[0], 1);
assert.equal(spectralFrameStart(15, parameters), 8);
assert.equal(spectralFrameStart(0, { ...parameters, origin: 3 }), -5);
const indices = Array.from({ length: 64 }, (_, i) => i);
const reductions = await prepareLocalSpectra(periodic, parameters, indices);
assert.equal(
  reductions.get(0),
  reductions.get(7),
  "Addresses in one frame must share a reduction",
);
assert.notEqual(reductions.get(0), reductions.get(8));
assert.equal(reductions.get(63)[1], 0, "Omitted tail must remain invalid");
const padded = localFrame(
  Uint8Array.of(1, 2),
  { ...parameters, edge: "zero", preprocessing: "unsigned", dc: true },
  -2,
);
assert.equal(padded.result[6], 2);
assert.deepEqual([...padded.samples].slice(0, 5), [0, 0, 1, 2, 0]);
assert.equal(
  await prepareLocalSpectra(periodic, parameters, indices, () => false),
  null,
);
await assert.rejects(
  prepareLocalSpectra(
    periodic,
    parameters,
    indices,
    () => true,
    () => {
      throw Error("budget");
    },
  ),
  /budget/,
);
for (const invalid of [
  { low: -1 },
  { high: 0.6 },
  { low: 0.3, high: 0.2 },
  { hop: 0 },
  { edge: "clip" },
  { taper: "unknown" },
])
  assert.throws(() => analysisParameters({ family: "spectral", ...invalid }));
const expression = { op: "analysis", offset: { op: "offset" }, ...parameters };
const program = compileRecipes({ x: expression });
const cache = {};
const visit = await pointFactors(
  {
    source: new Blob([periodic]),
    offset: 0,
    length: periodic.length,
    region: "linear",
    shaders: [],
    columns: 64,
    rows: 64,
    configuration: {
      ...presetConfiguration("linear"),
      sampling: "representative",
      sampleLimit: 8,
    },
    sampleLayout: { columns: 8, rows: 1 },
  },
  defaultAppearance("linear", []),
  cache,
  () => true,
  program,
);
const evaluate = program.createEvaluator(),
  values = [];
visit((factors, label, context) => {
  evaluate(factors, context);
  values.push(factors[program.bindings.x]);
});
assert.deepEqual(values, [1, 1, 1, 1, 1, 1, 1, 0]);
const description = cache.analysisProviders.describe(8, expression);
assert.equal(description.relativeBandEnergy, 1);
assert.deepEqual(description.sourceRange, { start: 8, endExclusive: 24 });
assert.equal(description.firstBin, 4);
assert.equal(description.lastBin, 4);
console.log(
  "Local spectrum checks pass: direct DFT/Parseval references, odd/even frames, taper/preprocessing, endpoint weights, frequency bands, zero power, padding, frame deduplication, budgets and provenance.",
);
