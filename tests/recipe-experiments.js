import assert from "node:assert/strict";
import {
  byteDifferences,
  laggedCoordinates,
  entropyContrast,
} from "../recipe-experiments.js";
import { compileRecipes, recipeRoots } from "../recipes.js";
import { pointFactors, windowEntropy } from "../point-factors.js";
import { presetConfiguration } from "../point-configuration.js";
import { defaultAppearance } from "../appearance.js";
import {
  validateProfile,
  parseProfile,
  serializeProfile,
} from "../profiles.js";

const close = (actual, expected, message) =>
  assert(
    Math.abs(actual - expected) < 1e-6,
    `${message}: ${actual} != ${expected}`,
  );

function evaluator(roots, bytes) {
  const program = compileRecipes(roots);
  const evaluate = program.createEvaluator();
  const values = new Float64Array(program.factorCount);
  const entropy = new Map(
    [...program.providers.entropy].map((window) => [
      window,
      windowEntropy(bytes, window, window === 32),
    ]),
  );
  const context = {
    offset: 0,
    length: bytes.length,
    byte: (index) => bytes[index] ?? 0,
    entropy: (index, window) =>
      (entropy.get(window)[index] ?? 0) / (window === 32 ? 255 : 1),
  };
  return {
    program,
    context,
    at(index) {
      context.offset = index;
      evaluate(values, context);
      return Object.fromEntries(
        Object.entries(program.bindings).map(([name, slot]) => [
          name,
          values[slot],
        ]),
      );
    },
  };
}

const differences = byteDifferences({ lag: 2 });
for (const bytes of [
  Uint8Array.from([33, 33, 33, 33, 33]),
  Uint8Array.from([0, 1, 2, 3, 4, 255, 0]),
  Uint8Array.from([255, 200, 100, 50, 0]),
]) {
  const evaluate = evaluator(differences, bytes);
  assert(evaluate.program.providers.byte);
  assert.equal(evaluate.program.providers.entropy.size, 0);
  assert.equal(evaluate.program.providers.spectrum.size, 0);
  assert.equal(evaluate.program.required.size, 0);
  for (let index = 0; index < bytes.length; index++) {
    const actual = evaluate.at(index);
    const change = bytes[index] - (bytes[index - 2] ?? 0);
    close(actual.signed, (change + 255) / 510, "Signed difference");
    close(actual.magnitude, Math.abs(change) / 255, "Magnitude difference");
    assert.equal(actual.valid, index >= 2 ? 1 : 0);
  }
}
assert.equal(evaluator(byteDifferences(), new Uint8Array()).at(0).valid, 0);
assert.equal(evaluator(differences, Uint8Array.of(7)).at(0).valid, 0);

// A repeated record exposes a diagonal when its stride is used as the lag.
const records = Uint8Array.from(
  { length: 30 },
  (_, index) => [9, 100, 240][index % 3],
);
for (const dimensions of [2, 3]) {
  const experiment = laggedCoordinates({ lag: 3, dimensions });
  assert.equal(experiment.position.length, 3);
  const roots = Object.fromEntries(
    experiment.position
      .map((expression, index) => [`p${index}`, expression])
      .filter(([, expression]) => expression !== "none"),
  );
  roots.valid = experiment.valid;
  const evaluate = evaluator(roots, records);
  assert.equal(evaluate.program.providers.entropy.size, 0);
  assert.equal(evaluate.program.providers.spectrum.size, 0);
  for (let index = 0; index < records.length; index++) {
    const actual = evaluate.at(index);
    assert.equal(
      actual.valid,
      index + (dimensions - 1) * 3 < records.length ? 1 : 0,
    );
    for (let axis = 0; axis < dimensions; axis++) {
      close(
        actual[`p${axis}`],
        (records[index + axis * 3] ?? 0) / 255,
        "Lagged byte",
      );
    }
  }
  assert.equal(
    evaluate.program.nodes.filter((node) => node.op === "byte").length,
    dimensions,
  );
}
assert.equal(laggedCoordinates({ dimensions: 2 }).position[2], "none");

// Offsets above Float32's adjacent-integer range must reach the exact byte address.
const large = 2 ** 24 + 1;
const exact = evaluator(byteDifferences({ lag: 7 }), Uint8Array.of(0));
const addresses = [];
exact.context.length = large + 10;
exact.context.byte = (index) => {
  addresses.push(index);
  return index === large ? 200 : 100;
};
close(exact.at(large).magnitude, 100 / 255, "Exact-address difference");
assert.deepEqual(addresses, [large, large - 7]);
const exactCoordinates = laggedCoordinates({ lag: 7, dimensions: 3 });
const exactLag = evaluator(
  {
    x: exactCoordinates.position[0],
    z: exactCoordinates.position[2],
    valid: exactCoordinates.valid,
  },
  Uint8Array.of(0),
);
const lagAddresses = [];
exactLag.context.length = large + 15;
exactLag.context.byte = (index) => {
  lagAddresses.push(index);
  return 0;
};
assert.equal(exactLag.at(large).valid, 1);
assert.deepEqual(lagAddresses, [large, large + 14]);
exactLag.context.length--;
assert.equal(exactLag.at(large).valid, 0);

const ramp = Uint8Array.from({ length: 1024 }, (_, index) => index % 256);
const contrast = entropyContrast();
const rampEntropy = evaluator(contrast, ramp);
const interior = rampEntropy.at(512);
close(interior.small, 5 / 8, "32-byte entropy in bits / 8");
close(interior.large, 1, "256-byte entropy in bits / 8");
close(interior.contrast, 5 / 16, "Five minus eight bits mapped to [-8,8]");
close(interior.magnitude, 3 / 8, "Entropy bit difference magnitude");
assert(!rampEntropy.program.providers.byte);
assert.deepEqual([...rampEntropy.program.providers.entropy], [32, 256]);
assert.equal(rampEntropy.program.providers.spectrum.size, 0);
for (const windows of [
  { smallWindow: 1, largeWindow: 1 },
  { smallWindow: 32, largeWindow: 32 },
  { smallWindow: 1, largeWindow: 256 },
]) {
  const evaluate = evaluator(
    entropyContrast(windows),
    new Uint8Array(512).fill(8),
  );
  for (const index of [0, 256, 511]) {
    const actual = evaluate.at(index);
    assert.equal(actual.small, 0);
    assert.equal(actual.large, 0);
    assert.equal(actual.contrast, 0.5);
    assert.equal(actual.magnitude, 0);
  }
}
const irregular = Uint8Array.from({ length: 128 }, (_, index) =>
  index % 3 === 0 ? 7 : 8,
);
const quantized = evaluator(
  entropyContrast({ smallWindow: 32, largeWindow: 64 }),
  irregular,
);
const raw32 = windowEntropy(irregular, 32, true);
for (const index of [0, 17, 64, 127]) {
  close(
    quantized.at(index).small,
    ((raw32[index] / 255) * 5) / 8,
    "Legacy quantization retained",
  );
}

// Exercise the actual lazy provider and root-file entropy halo, not only evaluator doubles.
const configuration = {
  ...presetConfiguration("linear"),
  population: "bytes",
  position: ["none", "none", "none"],
};
const appearance = {
  ...defaultAppearance("linear"),
  hue: contrast.contrast,
  lightness: contrast.small,
};
const program = compileRecipes(recipeRoots(configuration, appearance));
const job = {
  source: new Blob([ramp]),
  offset: 500,
  length: 16,
  configuration,
  region: "linear",
  sampleLayout: { columns: 16, rows: 1 },
  shaders: [],
};
const cache = {};
const visit = await pointFactors(job, appearance, cache, () => true, program);
assert(visit);
const evaluateProviders = program.createEvaluator();
visit((values, label, context) => {
  evaluateProviders(values, context);
  close(values[program.bindings.hue], 5 / 16, "Real provider contrast");
  close(values[program.bindings.lightness], 5 / 8, "Real provider halo");
});
assert.deepEqual([...cache.recipeEntropy.values.keys()], [32, 256]);
assert(!cache.factorSpectrum && !cache.factorCounts);

const profile = validateProfile({
  version: 3,
  region: "trigraph",
  configuration: {
    ...presetConfiguration("trigraph"),
    position: laggedCoordinates({ lag: 8 }).position,
  },
  recipes: { Difference: differences.magnitude },
  appearance: {
    ...defaultAppearance("trigraph"),
    hue: contrast.contrast,
    opacity: differences.valid,
  },
  shaders: [],
  rotation: { yaw: 0.2, pitch: 0.3 },
  coordinateSystem: "cartesian",
  axes: [0, 1, 2],
  encoding: "ascii",
  blankSpaces: false,
  blankNulls: true,
  frequencyOpacity: false,
});
assert.deepEqual(parseProfile(serializeProfile(profile)), profile);
assert.equal(profile.configuration.population, "triples");
assert.equal(profile.configuration.backend, "cpu");
const owned = byteDifferences();
owned.signed.min = 0;
assert.equal(byteDifferences().signed.min, -255);

for (const lag of [0, -1, 1.5, NaN, Infinity, "2", 1000001]) {
  assert.throws(() => byteDifferences({ lag }));
  assert.throws(() => laggedCoordinates({ lag }));
}
assert.throws(() => laggedCoordinates({ lag: 500001, dimensions: 3 }));
assert.doesNotThrow(() =>
  compileRecipes({
    ...byteDifferences({ lag: 1000000 }),
    tail: laggedCoordinates({ lag: 500000 }).valid,
  }),
);
for (const dimensions of [0, 1, 4, "3", NaN]) {
  assert.throws(() => laggedCoordinates({ dimensions }));
}
for (const window of [0, -1, 2.5, "32", NaN, Infinity, 4097]) {
  assert.throws(() => entropyContrast({ smallWindow: window }));
  assert.throws(() => entropyContrast({ largeWindow: window }));
}
assert.throws(() => entropyContrast({ smallWindow: 64, largeWindow: 32 }));
console.log(
  "Recipe experiment checks pass: differences, lagged coordinates, validity, exact indices, bit-unit entropy/legacy quantization, lazy providers/halos, parameter validation and profile round trips.",
);
