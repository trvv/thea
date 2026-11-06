import assert from "node:assert/strict";
import { analysisParameters } from "../src/analysis/analysis-parameters.js";
import {
  prepareOccurrence,
  countReference,
  occurrenceResult,
  describeOccurrence,
} from "../src/analysis/occurrence-analysis.js";
import { compileRecipes } from "../src/recipes/recipes.js";
import { pointFactors } from "../src/data/point-factors.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";

const data = Uint8Array.from([
  0, 1, 2, 0, 1, 2, 0, 1, 2, 255, 255, 255, 255, 0, 0, 0,
]);
const parameters = (values) =>
  analysisParameters({ family: "occurrence", ...values });
for (const width of [1, 2, 3]) {
  const model = await prepareOccurrence(
    data,
    width,
    () => true,
    () => {},
  );
  const counts = new Map();
  for (let i = 0; i + width <= data.length; i++) {
    const key = [...data.subarray(i, i + width)].join(",");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.values()].sort((a, b) => a - b);
  assert.equal(model.total, data.length - width + 1);
  assert.deepEqual([...model.sorted], sorted);
  for (const percentile of [0, 0.5, 0.99, 1]) {
    const p = parameters({ width, percentile });
    const rank = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
    assert.equal(countReference(model, p), sorted[rank]);
    assert.equal(
      countReference(model, { ...p, includeZero: true, percentile: 0.5 }),
      0,
    );
    assert.equal(
      countReference(model, { ...p, includeZero: true, percentile: 1 }),
      sorted.at(-1),
    );
    for (let i = 0; i < data.length; i++) {
      const valid = i + width <= data.length;
      const count = valid
        ? counts.get([...data.subarray(i, i + width)].join(","))
        : 0;
      assert.equal(
        occurrenceResult(data, i, { ...p, kind: "count" }, model),
        count,
      );
      assert.equal(
        occurrenceResult(data, i, { ...p, kind: "valid" }, model),
        valid ? 1 : 0,
      );
      assert.equal(
        occurrenceResult(data, i, { ...p, kind: "probability" }, model),
        count / model.total,
      );
      const expected = count ? Math.log1p(count) / Math.log1p(sorted[rank]) : 0;
      assert.equal(
        occurrenceResult(data, i, { ...p, kind: "exposure" }, model),
        expected,
      );
    }
  }
  const fixed = parameters({
    width,
    reference: "fixed",
    referenceValue: 3,
    compression: 2,
    exposure: 4,
  });
  assert.equal(countReference(model, fixed), 3);
  const detail = describeOccurrence(data, 0, fixed, model);
  assert.equal(detail.referenceCount, 3);
  assert.equal(
    detail.count,
    counts.get([...data.subarray(0, width)].join(",")),
  );
  assert(detail.exposureValue > 0);
  assert.deepEqual(detail.tuple, [...data.subarray(0, width)]);
  assert.equal(occurrenceResult(data, NaN, fixed, model), 0);
}

const sparseAlphabet = await prepareOccurrence(
  Uint8Array.of(1, 2, 3, 4),
  3,
  () => true,
  () => {},
);
assert.equal(sparseAlphabet.alphabet, 16777216);
assert.equal(
  sparseAlphabet.sorted.length,
  2,
  "Implicit absent triples must not allocate a full alphabet",
);
const zeroReference = parameters({
  width: 3,
  includeZero: true,
  percentile: 0.5,
});
assert.equal(countReference(sparseAlphabet, zeroReference), 0);
assert.equal(
  occurrenceResult(
    Uint8Array.of(1, 2, 3, 4),
    0,
    { ...zeroReference, kind: "exposure" },
    sparseAlphabet,
  ),
  0,
);
assert.equal(
  describeOccurrence(
    Uint8Array.of(1, 2, 3, 4),
    0,
    zeroReference,
    sparseAlphabet,
  ).referenceValid,
  false,
);

// Normalize exact raw counters before the ordinary scalar f32 conversion.
const exactCounts = new Float64Array(256);
exactCounts[1] = 2 ** 24 + 1;
const exact = {
  width: 1,
  counts: exactCounts,
  total: 2 ** 24 + 2,
  sorted: Float64Array.of(2 ** 24 + 1),
  observed: 1,
  alphabet: 256,
};
const probability = occurrenceResult(
  Uint8Array.of(1),
  0,
  parameters({ kind: "probability" }),
  exact,
);
assert.equal(probability, (2 ** 24 + 1) / (2 ** 24 + 2));
assert.notEqual(
  Math.fround(probability),
  Math.fround(Math.fround(2 ** 24 + 1) / (2 ** 24 + 2)),
);
assert.equal(
  describeOccurrence(Uint8Array.of(1), 0, parameters({}), exact).count,
  2 ** 24 + 1,
);

const source = new Blob([Uint8Array.of(77, 77), data, Uint8Array.of(88)]);
const job = {
  kind: "view",
  source,
  offset: 2,
  length: data.length,
  region: "linear",
  shaders: [],
  configuration: {
    ...presetConfiguration("linear"),
    sampling: "representative",
  },
  sampleLayout: { columns: data.length, rows: 1 },
  columns: 32,
  rows: 32,
};
const op = (kind) => ({
  op: "analysis",
  offset: { op: "offset" },
  ...parameters({ width: 2, kind }),
});
const program = compileRecipes({
  hue: op("exposure"),
  opacity: op("probability"),
});
const cache = {};
const visit = await pointFactors(
  job,
  defaultAppearance("linear", []),
  cache,
  () => true,
  program,
);
assert.equal(
  cache.analysisProviders.occurrences.size,
  1,
  "Channels must share exact raw counts",
);
const rawModel = cache.analysisProviders.occurrences.get(2);
const actual = [];
visit((factors, label, context) =>
  actual.push(context.analysis(context.offset, op("exposure"))),
);
const sampled = await pointFactors(
  { ...job, configuration: { ...job.configuration, sampleLimit: 4 } },
  defaultAppearance("linear", []),
  cache,
  () => true,
  program,
);
assert.equal(
  cache.analysisProviders.occurrences.get(2),
  rawModel,
  "Changing sampling rebuilt exact raw counts",
);
sampled((factors, label, context) =>
  assert.equal(
    context.analysis(context.offset, op("exposure")),
    actual[context.offset],
  ),
);
const detail = cache.analysisProviders.describe(0, op("exposure"));
assert.deepEqual(detail.selection, { start: 2, endExclusive: 18 });
assert.deepEqual(detail.sourceRange, { start: 2, endExclusive: 4 });
assert.equal(detail.count, 3);

for (const values of [
  { width: 0 },
  { width: 4 },
  { percentile: -1 },
  { percentile: 2 },
  { includeZero: 1 },
  { reference: "frame" },
  { referenceValue: 0 },
  { referenceValue: Infinity },
  { exposure: 0 },
  { compression: -1 },
])
  assert.throws(() => parameters(values));
await assert.rejects(
  () =>
    prepareOccurrence(
      data,
      3,
      () => true,
      (bytes) => {
        if (bytes > 96) throw new RangeError("budget");
      },
    ),
  /budget/,
);
let alive = true;
setTimeout(() => {
  alive = false;
}, 0);
assert.equal(
  await prepareOccurrence(
    new Uint8Array(2 ** 20),
    1,
    () => alive,
    () => {},
  ),
  null,
);

console.log(
  "Occurrence analysis passes: exact counts/probabilities, nearest-rank references, implicit zero alphabets, exposure, pre-f32 precision, sampling independence, scopes, sharing, validation, budgets and cancellation.",
);
