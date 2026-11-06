import assert from "node:assert/strict";
import { analysisParameters } from "../src/analysis/analysis-parameters.js";
import {
  prepareReduction,
  reductionResult,
  reductionValues,
} from "../src/analysis/occurrence-reductions.js";
import { windowEntropy } from "../src/analysis/entropy.js";
import { compileRecipes } from "../src/recipes/recipes.js";
import { pointFactors } from "../src/data/point-factors.js";
import { sampleProvenance } from "../src/inspection/point-provenance.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";

const parameters = (values) =>
  analysisParameters({ family: "reduction", ...values });
const near = (actual, expected, label) =>
  assert(
    Math.abs(actual - expected) < 1e-12,
    `${label}: ${actual} != ${expected}`,
  );
const data = Uint8Array.from(
  { length: 128 },
  (_, i) => [0, 1, 0, 1, 2, 3, 255, 255][i % 8],
);
for (const width of [2, 3])
  for (const window of [1, 2, 7, 16, 32, 33, 256]) {
    const p = parameters({ width, window });
    const model = await prepareReduction(
      data,
      p,
      () => true,
      () => {},
    );
    const entropy = windowEntropy(data, window, window === 32);
    const expected = new Map();
    for (let index = 0; index + width <= data.length; index++) {
      const key = [...data.subarray(index, index + width)].join(",");
      const aggregate = expected.get(key) || { count: 0, sum: 0 };
      aggregate.count++;
      aggregate.sum += window === 32 ? entropy[index] / 255 : entropy[index];
      expected.set(key, aggregate);
    }
    for (let index = 0; index < data.length; index++) {
      const valid = index + width <= data.length;
      const aggregate = valid
        ? expected.get([...data.subarray(index, index + width)].join(","))
        : { count: 0, sum: 0 };
      const actual = reductionValues(data, index, model);
      assert.equal(actual.count, aggregate.count);
      near(actual.sum, aggregate.sum, "Occurrence entropy sum");
      near(
        actual.mean,
        aggregate.count ? aggregate.sum / aggregate.count : 0,
        "Occurrence entropy mean",
      );
      assert.equal(actual.valid, valid);
      assert.equal(
        reductionResult(data, index, { ...p, kind: "count" }, model),
        aggregate.count,
      );
      assert.equal(
        reductionResult(data, index, { ...p, kind: "valid" }, model),
        valid ? 1 : 0,
      );
    }
    assert.equal(reductionResult(data, -1, p, model), 0);
    assert.equal(reductionResult(data, NaN, p, model), 0);
    assert(
      !Object.hasOwn(model, "offsets") && !Object.hasOwn(model, "entropy"),
      "Do not retain occurrences or a source-length entropy result",
    );
  }

// The same tuple occurs once in repetitive context and once in varied context.
const contexts = new Uint8Array(256);
for (let i = 180; i < 224; i++) contexts[i] = (i * 17) % 251;
contexts.set([200, 201, 202], 20);
contexts.set([200, 201, 202], 200);
const p = parameters({ width: 3, window: 32 });
const model = await prepareReduction(
  contexts,
  p,
  () => true,
  () => {},
);
const entropy = windowEntropy(contexts, 32, true);
const expectedMean = (entropy[20] + entropy[200]) / (255 * 2);
const actualMean = reductionResult(contexts, 20, p, model);
near(actualMean, expectedMean, "Different-context mean");
assert.equal(reductionResult(contexts, 20, { ...p, kind: "count" }, model), 2);
assert.equal(reductionResult(contexts, 200, p, model), actualMean);
assert.notEqual(
  actualMean,
  entropy[20] / 255,
  "A reduction is not first occurrence lookup",
);
assert.notEqual(
  actualMean,
  entropy[200] / 255,
  "A reduction is not last occurrence lookup",
);
assert.notEqual(
  actualMean,
  entropy[110] / 255,
  "A reduction is not entropy at the average address",
);

const source = new Blob([Uint8Array.of(77, 88), contexts, Uint8Array.of(99)]);
const job = {
  kind: "view",
  source,
  offset: 2,
  length: contexts.length,
  region: "linear",
  shaders: [],
  configuration: {
    ...presetConfiguration("linear"),
    population: "triples",
    sampling: "representative",
  },
  sampleLayout: { columns: 256, rows: 1 },
  columns: 256,
  rows: 32,
};
const expression = { op: "analysis", offset: { op: "offset" }, ...p };
const program = compileRecipes({
  hue: expression,
  size: { ...expression, kind: "count" },
});
const cache = {};
let firstMean, lastMean, description;
let visit = await pointFactors(
  job,
  defaultAppearance("linear", []),
  cache,
  () => true,
  program,
);
const rawModel = [...cache.analysisProviders.reductions.values()][0];
visit((factors, label, context) => {
  if (
    context.byte(context.offset) !== 200 ||
    context.byte(context.offset + 1) !== 201 ||
    context.byte(context.offset + 2) !== 202
  )
    return;
  assert.equal(context.offset, 20);
  firstMean = context.analysis(context.offset, p);
  description = sampleProvenance(
    job,
    visit.provenance,
    factors,
    context,
  ).describeAnalysis(context.offset, expression);
});
visit = await pointFactors(
  {
    ...job,
    configuration: { ...job.configuration, tupleRepresentative: "last" },
  },
  defaultAppearance("linear", []),
  cache,
  () => true,
  program,
);
visit((factors, label, context) => {
  if (
    context.byte(context.offset) === 200 &&
    context.byte(context.offset + 1) === 201 &&
    context.byte(context.offset + 2) === 202
  ) {
    assert.equal(context.offset, 200);
    lastMean = context.analysis(context.offset, p);
  }
});
assert.equal(firstMean, lastMean);
assert.equal(
  [...cache.analysisProviders.reductions.values()][0],
  rawModel,
  "Representative changes do not redefine or rebuild the model",
);
assert.equal(description.count, 2);
assert.equal(description.mean, actualMean);
assert.equal(description.neighborhoodScope, "selection");
assert.deepEqual(description.selection, { start: 2, endExclusive: 258 });
assert.deepEqual(description.sourceRange, { start: 22, endExclusive: 25 });

const sampled = await pointFactors(
  { ...job, configuration: { ...job.configuration, sampleLimit: 4 } },
  defaultAppearance("linear", []),
  cache,
  () => true,
  program,
);
assert(sampled);
assert.equal([...cache.analysisProviders.reductions.values()][0], rawModel);
const fresh = {};
await pointFactors(
  job,
  defaultAppearance("linear", []),
  fresh,
  () => true,
  program,
);
assert.deepEqual(
  [...fresh.analysisProviders.reductions.values()][0].counts,
  rawModel.counts,
);
assert.equal(
  compileRecipes(JSON.parse(JSON.stringify({ hue: expression }))).key,
  compileRecipes({ hue: expression }).key,
);

for (const values of [
  { width: 1 },
  { width: 4 },
  { window: 0 },
  { window: 4097 },
  { measure: "value" },
  { scope: "root" },
])
  assert.throws(() => parameters(values));
await assert.rejects(
  () =>
    prepareReduction(
      data,
      parameters({ width: 2 }),
      () => true,
      (bytes) => {
        if (bytes > 1024) throw new RangeError("budget");
      },
    ),
  /budget/,
);
let checks = 0;
assert.equal(
  await prepareReduction(
    new Uint8Array(2 ** 20),
    parameters({}),
    () => ++checks < 3,
    () => {},
  ),
  null,
);

console.log(
  "Occurrence reductions pass: direct rolling-entropy oracle, quantization, exact all-occurrence counts/sums, context-sensitive means, first/last and average-address distinctions, scopes, sampling independence, cache parity, budgets and cancellation.",
);
