import assert from "node:assert/strict";
import {
  sampleSpectrum,
  describeSpectrumSample,
} from "../spectrum-sampling.js";
import { spectrumComponents } from "../spectrum.js";
import { compileRecipes } from "../recipes.js";
import { pointFactors } from "../point-factors.js";
import { presetConfiguration } from "../point-configuration.js";
import { defaultAppearance } from "../appearance.js";

const length = 4;
const spectrum = spectrumComponents(
  {
    real: Float64Array.of(-2, -2, 1),
    imaginary: Float64Array.of(-0.01, 0.01, 0),
  },
  length,
  true,
  true,
);
for (const position of [-10, 0, 0.1, 0.5, 0.99, 1, 10]) {
  const bin = Math.min(2, Math.floor(Math.max(0, Math.min(1, position)) * 3));
  assert.equal(
    sampleSpectrum(spectrum, length, "phase", position),
    spectrum.phases[bin],
  );
  assert.equal(
    sampleSpectrum(spectrum, length, "amplitude", position),
    spectrum.amplitudes[bin],
  );
  assert.equal(
    sampleSpectrum(undefined, length, "frequency", position),
    bin / 2,
  );
  const coordinate = Math.max(0, Math.min(1, position)) * 2;
  assert.equal(
    sampleSpectrum(undefined, length, "frequency", position, "complex"),
    coordinate / 2,
  );
}
const blend = describeSpectrumSample(
  spectrum,
  length,
  "phase",
  0.25,
  "complex",
);
assert.equal(blend.real, -2);
assert.equal(blend.imaginary, 0);
assert.equal(blend.lowerBin, 0);
assert.equal(blend.upperBin, 1);
assert.equal(blend.fraction, 0.5);
assert.equal(
  sampleSpectrum(spectrum, length, "phase", 0.25, "complex"),
  1,
  "Complex phase must not average wrapped endpoints to 0.5",
);
assert.equal(
  describeSpectrumSample(spectrum, length, "amplitude", 0.25, "complex")
    .oneSidedMultiplier,
  1.5,
);
const expectedAmplitude = (2 * 1.5) / length;
assert.equal(
  sampleSpectrum(spectrum, length, "amplitude", 0.25, "complex"),
  Math.log1p(expectedAmplitude) / Math.log1p(spectrum.peakAmplitude),
);
assert.equal(
  sampleSpectrum(spectrum, length, "amplitude", 1, "complex"),
  spectrum.amplitudes[2],
);
assert.equal(sampleSpectrum(undefined, 0, "frequency", 0.5, "complex"), 0);
assert.equal(
  describeSpectrumSample(undefined, 0, "frequency", 0.5, "complex").valid,
  false,
);
assert.throws(() =>
  compileRecipes({
    x: {
      op: "spectrum",
      input: "position",
      kind: "phase",
      interpolation: "linearPhase",
    },
  }),
);

const bytes = Uint8Array.from(
  { length: 32 },
  (_, i) => [128, 255, 128, 1][i % 4],
);
const expression = {
  op: "spectrum",
  input: "position",
  kind: "amplitude",
  interpolation: "complex",
};
const program = compileRecipes({ x: expression });
const cache = {};
const visit = await pointFactors(
  {
    source: new Blob([bytes]),
    offset: 0,
    length: bytes.length,
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
const evaluate = program.createEvaluator();
visit((factors, label, context) => {
  evaluate(factors, context);
  const expected = sampleSpectrum(
    cache.factorSpectrum,
    bytes.length,
    "amplitude",
    Math.fround(context.offset / 31),
    "complex",
  );
  assert.equal(
    factors[program.bindings.x],
    Math.fround(Math.max(0, Math.min(1, expected))),
  );
});
const frequency = compileRecipes({ x: { ...expression, kind: "frequency" } });
assert.equal(frequency.providers.spectrum.has("amplitude"), false);
console.log(
  "Spectrum interpolation passes: legacy bucket parity, continuous frequency, complex phase seam, endpoint-weight amplitude, empty input, validation and real provider integration.",
);
