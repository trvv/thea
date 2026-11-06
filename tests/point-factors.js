import assert from "node:assert/strict";
import { pointFactors } from "../src/data/point-factors.js";
import {
  factorIndices as slots,
  requiredFactors,
} from "../src/recipes/factors.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import {
  defaultAppearance,
  occurrenceFactor,
} from "../src/recipes/appearance.js";
import {
  entropyShading,
  byteCharacter,
  hilbertCells,
  executeRender,
  renderCost,
} from "../src/render/rendering.js";
import { fourierSpectrum } from "../src/analysis/fourier.js";
import { RenderCanvas } from "./render-canvas.js";
let reads = 0;
class Source extends Blob {
  slice(...args) {
    reads++;
    return super.slice(...args);
  }
}
const data = Uint8Array.from({ length: 64 }, (_, i) => [3, 5, 3, 7][i % 4]);
const source = new Source([data]);
const base = {
  kind: "view",
  source,
  sourceId: 1,
  offset: 4,
  length: 16,
  columns: 32,
  rows: 24,
  width: 32,
  height: 24,
  scale: 1,
  region: "linear",
  configuration: presetConfiguration("linear"),
  sampleLayout: { columns: 4, rows: 4 },
  shaders: [],
};
const plain = {
  ...defaultAppearance("linear"),
  hue: "none",
  lightness: "none",
};

async function collect(job = base, appearance = plain, cache = {}) {
  const visit = await pointFactors(job, appearance, cache, () => true),
    points = [];
  visit((values, label) => points.push({ values: [...values], label }));
  return points;
}
const idle = {};
await collect(base, plain, idle);
assert.equal(reads, 0, "Layout-only points read the binary");
assert(!idle.factorSpectrum && !idle.factorCounts && !idle.factorEntropy);
const hiddenZ = {
  ...base,
  configuration: {
    ...base.configuration,
    position: ["column", "row", "phase"],
  },
};
assert(!requiredFactors(hiddenZ.configuration, plain).has("phase"));
await collect(hiddenZ);
assert.equal(reads, 0, "Invisible axis requested a transform");
const frequency = {
  ...base,
  configuration: {
    ...base.configuration,
    position: ["frequency", "row", "none"],
  },
};
const frequencies = await collect(frequency);
assert.equal(reads, 0, "Frequency indices should not require FFT/data");
assert.equal(frequencies.at(-1).values[slots.frequency], 1);
const neighbors = {
  ...base,
  configuration: {
    ...base.configuration,
    position: ["value", "byte2", "none"],
  },
};
const neighborPoints = await collect(neighbors, {
  ...plain,
  hue: "byte3",
  size: "previous",
});
assert.equal(neighborPoints[0].values[slots.value], data[4] / 255);
assert.equal(neighborPoints[0].values[slots.byte2], data[5] / 255);
assert.equal(neighborPoints[0].values[slots.byte3], data[6] / 255);
assert.equal(
  neighborPoints[0].values[slots.previous],
  0,
  "Previous byte leaked outside selection",
);
assert.equal(
  neighborPoints.at(-1).values[slots.byte2],
  0,
  "Next byte leaked outside selection",
);
const cache = {},
  phaseStyle = { ...plain, hue: "phase" };
const phasePoints = await collect(base, phaseStyle, cache);
assert(cache.factorSpectrum?.phases);
assert(
  !cache.factorSpectrum.amplitudes &&
    !cache.factorCounts &&
    !cache.factorEntropy,
  "Phase requested unrelated providers",
);
const savedSpectrum = cache.factorSpectrum,
  readCount = reads;
const mixed = await collect(
  neighbors,
  { ...phaseStyle, lightness: "amplitude", opacity: "pairCount" },
  cache,
);
assert.equal(
  cache.factorSpectrum,
  savedSpectrum,
  "Adding amplitude repeated FFT",
);
assert.equal(reads, readCount, "Adding factors reread cached bytes");
assert(
  cache.factorCounts.pair &&
    !cache.factorCounts.byte &&
    !cache.factorCounts.triple,
  "Pair counts built other histograms",
);
assert(!cache.factorEntropy, "No entropy selected");
const selected = data.slice(4, 20),
  { real, imaginary } = fourierSpectrum(selected);
for (let i = 0; i < mixed.length; i++) {
  const bin = Math.floor((i * (selected.length / 2 + 1)) / selected.length);
  const angle =
    Math.abs(imaginary[bin]) < Math.hypot(real[bin], imaginary[bin]) * 1e-12
      ? real[bin] >= 0
        ? 0
        : Math.PI
      : Math.atan2(imaginary[bin], real[bin]);
  assert(
    Math.abs(
      phasePoints[i].values[slots.phase] - (angle + Math.PI) / (2 * Math.PI),
    ) < 1e-12,
  );
}
const counted = await collect(
  neighbors,
  { ...plain, hue: "byteCount", lightness: "tripleCount", size: "entropy" },
  cache,
);
assert(cache.factorEntropy);
assert(cache.factorCounts.byte && cache.factorCounts.triple);
const entropyEntry = cache.factorEntropy,
  expectedEntropy = entropyShading(data);
for (let i = 0; i < counted.length; i++)
  assert.equal(
    counted[i].values[slots.entropy],
    expectedEntropy[base.offset + i] / 255,
  );
assert.equal(counted[0].values[slots.byteCount], occurrenceFactor(8));
let triple = 0;
for (let i = 0; i < selected.length - 2; i++)
  if (selected[i] === 3 && selected[i + 1] === 5 && selected[i + 2] === 3)
    triple++;
assert.equal(counted[0].values[slots.tripleCount], occurrenceFactor(triple));
await collect(base, { ...plain, hue: "entropy" }, cache);
assert.equal(
  cache.factorEntropy,
  entropyEntry,
  "Entropy repeated for same window",
);
await collect(
  {
    ...base,
    configuration: {
      ...base.configuration,
      position: ["value", "byte2", "none"],
    },
  },
  plain,
  cache,
);
const fresh = {};
await collect({ ...base, offset: 8 }, phaseStyle, cache);
await collect({ ...base, offset: 8 }, phaseStyle, fresh);
assert.deepEqual(
  cache.factorSpectrum.real,
  fresh.factorSpectrum.real,
  "Spectrum cache survived the wrong window",
);
assert(
  renderCost({ ...base, appearance: phaseStyle }) >
    renderCost({ ...base, appearance: plain }),
  "Cost prediction omits FFT",
);
for (const space of ["square", "circle", "cube", "cylinder", "sphere"]) {
  const job = {
    ...base,
    configuration: {
      ...base.configuration,
      space,
      position: ["value", "byte2", "entropy"],
    },
    appearance: {
      ...plain,
      hue: "phase",
      lightness: "amplitude",
      opacity: "pairCount",
      size: "byte3",
    },
  };
  const canvas = new RenderCanvas();
  await executeRender(canvas, job);
  assert(
    canvas.pixels.some((v, i) => i % 4 !== 3 && v > 0),
    "Mixed factors produced no visible points",
  );
}
for (const length of [0, 1, 2, 7, 16])
  await collect({ ...base, length }, phaseStyle, {});
console.log(
  "Factor checks pass: universal mixing, exact neighbors and spectra, selection boundaries, lazy reads/FFT/entropy/histograms/layout, cache reuse/invalidation, all spaces, cost prediction, empty/short inputs.",
);
