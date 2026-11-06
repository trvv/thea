import assert from "node:assert/strict";
import { prepareRepetition } from "../src/analysis/repetition.js";
import { analysisParameters } from "../src/analysis/analysis-parameters.js";
import { compileRecipes } from "../src/recipes/recipes.js";
import { pointFactors } from "../src/data/point-factors.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";

const direct = (bytes, index, parameters) => {
  let previous = -1;
  if (index + 4 <= bytes.length) {
    for (
      let candidate = Math.max(0, index - parameters.history);
      candidate < index;
      candidate++
    ) {
      if (!parameters.overlap && candidate + 4 > index) continue;
      if (
        bytes
          .subarray(candidate, candidate + 4)
          .every((value, n) => value === bytes[index + n])
      )
        previous = candidate;
    }
  }
  let length = previous < 0 ? 0 : 4;
  const maximum =
    previous < 0
      ? 0
      : Math.min(
          parameters.maxLength,
          parameters.overlap ? parameters.maxLength : index - previous,
        );
  while (
    previous >= 0 &&
    length < maximum &&
    index + length < bytes.length &&
    bytes[previous + length] === bytes[index + length]
  )
    length++;
  return [
    previous,
    previous < 0 ? 0 : index - previous,
    length,
    previous < 0 ? 0 : 1,
  ];
};
let seed = 83;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed >>> 28;
};
const fixtures = [
  new Uint8Array(64),
  Uint8Array.from({ length: 80 }, (_, i) => i % 8),
  Uint8Array.from({ length: 256 }, random),
  Uint8Array.of(1, 2, 3, 4, 5, 6, 77, 88, 1, 2, 3, 4, 5, 6, 99),
];
for (const bytes of fixtures) {
  const indices = Array.from({ length: bytes.length }, (_, i) => i);
  for (const history of [1, 3, 4, 8, 64]) {
    for (const overlap of [false, true]) {
      const parameters = analysisParameters({
        family: "repetition",
        history,
        overlap,
        maxLength: 16,
      });
      const results = await prepareRepetition(bytes, parameters, indices);
      for (const index of indices)
        assert.deepEqual(results.get(index), direct(bytes, index, parameters));
      const sparse = indices.filter((index) => index % 13 === 0);
      const sampled = await prepareRepetition(bytes, parameters, sparse);
      for (const index of sparse)
        assert.deepEqual(sampled.get(index), results.get(index));
    }
  }
}
const parameters = analysisParameters({ family: "repetition" });
assert.equal(
  await prepareRepetition(
    new Uint8Array(100000),
    parameters,
    [99999],
    () => false,
  ),
  null,
);
await assert.rejects(
  prepareRepetition(
    new Uint8Array(32),
    parameters,
    [10],
    () => true,
    () => {
      throw new RangeError("budget");
    },
  ),
  /budget/,
);
assert.throws(() => analysisParameters({ family: "repetition", history: 0 }));
assert.throws(() => analysisParameters({ family: "repetition", overlap: 1 }));
assert.throws(() => analysisParameters({ family: "repetition", maxLength: 3 }));

const bytes = fixtures[3];
const source = new Blob([Uint8Array.of(99, 88), bytes]);
const expression = {
  op: "analysis",
  offset: { op: "offset" },
  family: "repetition",
  history: 64,
  kind: "distance",
};
const program = compileRecipes({
  x: { op: "divide", a: expression, b: { op: "constant", value: 64 } },
});
const cache = {};
const job = {
  source,
  offset: 2,
  length: bytes.length,
  region: "linear",
  shaders: [],
  columns: 64,
  rows: 64,
  configuration: {
    ...presetConfiguration("linear"),
    sampling: "representative",
  },
  sampleLayout: { columns: 16, rows: 1 },
};
const visit = await pointFactors(
  job,
  defaultAppearance("linear", []),
  cache,
  () => true,
  program,
);
const evaluate = program.createEvaluator();
const values = [];
visit((factors, label, context) => {
  evaluate(factors, context);
  values.push(factors[program.bindings.x]);
});
assert.equal(values[8], 8 / 64);
const description = cache.analysisProviders.describe(8, expression);
assert.equal(description.distance, 8);
assert.deepEqual(description.previousRange, { start: 2, endExclusive: 6 });
assert.equal(description.sourceOffset, 10);
console.log(
  "Repetition checks pass: direct nearest-match reference, history expiration, overlap eligibility, chosen-candidate extension, sparse requests, budgets, cancellation and provider provenance.",
);
