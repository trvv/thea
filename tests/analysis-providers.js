import assert from "node:assert/strict";
import { compileRecipes } from "../src/recipes/recipes.js";
import { pointFactors } from "../src/data/point-factors.js";
import { sampleProvenance } from "../src/inspection/point-provenance.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { analysisParameters } from "../src/analysis/analysis-parameters.js";

const close = (a, b, message) =>
  assert(Math.abs(a - b) < 1e-9, `${message}: ${a} != ${b}`);
const binaryEntropy = (p) =>
  p > 0 && p < 1 ? -p * Math.log2(p) - (1 - p) * Math.log2(1 - p) : 0;
const operation = (family, kind, parameters = {}) => ({
  op: "analysis",
  family,
  kind,
  offset: { op: "offset" },
  ...parameters,
});
const plain = defaultAppearance("linear", []);
function fixture(bytes) {
  return {
    kind: "view",
    source: new Blob([bytes]),
    offset: 0,
    length: bytes.length,
    region: "linear",
    columns: bytes.length || 1,
    rows: 1,
    shaders: [],
    sampleLayout: { columns: bytes.length || 1, rows: 1 },
    configuration: {
      ...presetConfiguration("linear"),
      sampling: "representative",
    },
  };
}
async function evaluate(bytes, expressions, overrides = {}, cache = {}) {
  const job = { ...fixture(bytes), ...overrides };
  const program = compileRecipes(expressions);
  const visit = await pointFactors(job, plain, cache, () => true, program);
  assert(visit);
  const evaluate = program.createEvaluator();
  const results = [];
  visit((factors, label, context) => {
    const raw = {};
    for (const [name, expression] of Object.entries(expressions)) {
      if (expression.op === "analysis" && expression.offset?.op === "offset")
        raw[name] = context.analysis(context.offset, {
          ...analysisParameters(expression),
        });
    }
    evaluate(factors, context);
    results.push({
      raw,
      output: Object.fromEntries(
        Object.entries(program.bindings).map(([name, slot]) => [
          name,
          factors[slot],
        ]),
      ),
      provenance: sampleProvenance(job, visit.provenance, factors, context),
    });
  });
  return { results, cache, visit, job };
}
const data = Uint8Array.from(
  { length: 96 },
  (_, i) => [0, 1, 0, 1, 2, 3, 128, 255][i % 8],
);

// First-order models fit only the selected interval; first byte is unavailable.
const conditional = await evaluate(data, {
  probability: operation("conditional", "probability"),
  surprise: operation("conditional", "surprise"),
  valid: operation("conditional", "valid"),
});
assert.equal(conditional.cache.analysisProviders.groups.size, 1);
for (let i = 0; i < data.length; i++) {
  assert.equal(conditional.results[i].raw.valid, i ? 1 : 0);
  if (!i) {
    assert.equal(conditional.results[i].raw.probability, 0);
    continue;
  }
  let row = 0,
    pair = 0;
  for (let j = 1; j < data.length; j++)
    if (data[j - 1] === data[i - 1]) {
      row++;
      if (data[j] === data[i]) pair++;
    }
  const p = (pair + 1 / 256) / (row + 1);
  close(conditional.results[i].raw.probability, p, "Conditional probability");
  close(
    conditional.results[i].raw.surprise,
    -Math.log2(p),
    "Conditional surprise",
  );
  const description = conditional.results[i].provenance.describeAnalysis(
    i,
    operation("conditional", "surprise"),
  );
  assert.equal(description.rowCount, row);
  assert.equal(description.transitionCount, pair);
  assert.equal(
    description.training,
    "selected interval, including scored transition",
  );
}
const anomaly = new Uint8Array(1024);
anomaly[1000] = 1;
const surprise = await evaluate(anomaly, {
  raw: operation("conditional", "surprise"),
});
assert(
  surprise.results[1000].raw.raw > 8,
  "Raw surprise was clamped to one byte's entropy",
);
assert.equal(
  surprise.results[1000].output.raw,
  1,
  "Terminal visual output should still clamp normally",
);

function referenceLag(bytes, index, window, lag) {
  const left = window ? Math.max(0, index - Math.floor(window / 2)) : 0;
  const right = window
    ? Math.min(bytes.length, index + window - Math.floor(window / 2))
    : bytes.length;
  const pairs = [],
    rows = new Map(),
    columns = new Map(),
    joint = new Map();
  let equal = 0,
    difference = 0;
  for (let i = Math.max(lag, left); i < right; i++) {
    const a = bytes[i - lag],
      b = bytes[i],
      key = a * 256 + b;
    pairs.push([a, b]);
    rows.set(a, (rows.get(a) || 0) + 1);
    columns.set(b, (columns.get(b) || 0) + 1);
    joint.set(key, (joint.get(key) || 0) + 1);
    if (a === b) equal++;
    difference += Math.abs(a - b);
  }
  let information = 0;
  for (const [key, count] of joint) {
    const a = Math.floor(key / 256),
      b = key % 256;
    information +=
      (count / pairs.length) *
      Math.log2((count * pairs.length) / (rows.get(a) * columns.get(b)));
  }
  return {
    equality: pairs.length ? equal / pairs.length : 0,
    difference: pairs.length ? difference / pairs.length / 255 : 0,
    information,
    pairs: pairs.length,
    valid: pairs.length ? 1 : 0,
  };
}
for (const window of [0, 1, 7, 16, 128])
  for (const lag of [1, 2, 8, 128]) {
    const kinds = ["equality", "difference", "information", "pairs", "valid"];
    const { results, cache } = await evaluate(
      data,
      Object.fromEntries(
        kinds.map((kind) => [kind, operation("lag", kind, { window, lag })]),
      ),
    );
    assert.equal(cache.analysisProviders.groups.size, 1);
    if (!window)
      assert.equal(
        [...cache.analysisProviders.groups.values()][0].results.size,
        1,
      );
    for (let i = 0; i < data.length; i++) {
      const expected = referenceLag(data, i, window, lag);
      for (const kind of kinds)
        close(
          results[i].raw[kind],
          expected[kind],
          `Lag ${lag}/${window}/${kind}/${i}`,
        );
    }
  }
const constant = await evaluate(new Uint8Array(32).fill(7), {
  equal: operation("lag", "equality"),
  information: operation("lag", "information"),
});
assert(
  constant.results.every(
    (point) => point.raw.equal === 1 && Math.abs(point.raw.information) < 1e-12,
  ),
);

function referenceDistribution(bytes, index, window, gap) {
  const left = bytes.slice(
    Math.max(0, index - gap - window),
    Math.max(0, index - gap),
  );
  const right = bytes.slice(
    Math.min(bytes.length, index + gap),
    Math.min(bytes.length, index + gap + window),
  );
  if (!left.length || !right.length)
    return { variation: 0, divergence: 0, valid: 0 };
  let variation = 0,
    divergence = 0;
  for (let b = 0; b < 256; b++) {
    const p = [...left].filter((value) => value === b).length / left.length;
    const q = [...right].filter((value) => value === b).length / right.length;
    const m = (p + q) / 2;
    variation += Math.abs(p - q) / 2;
    if (p) divergence += (p * Math.log2(p / m)) / 2;
    if (q) divergence += (q * Math.log2(q / m)) / 2;
  }
  return { variation, divergence, valid: 1 };
}
for (const window of [1, 7, 32, 128])
  for (const gap of [0, 2, 200]) {
    const kinds = ["variation", "divergence", "valid"];
    const { results } = await evaluate(
      data,
      Object.fromEntries(
        kinds.map((kind) => [
          kind,
          operation("distribution", kind, { window, gap }),
        ]),
      ),
    );
    for (let i = 0; i < data.length; i++) {
      const expected = referenceDistribution(data, i, window, gap);
      for (const kind of kinds)
        close(
          results[i].raw[kind],
          expected[kind],
          `Distribution ${window}/${gap}/${kind}/${i}`,
        );
    }
  }
const transition = Uint8Array.from({ length: 64 }, (_, i) =>
  i < 32 ? 0 : 255,
);
const boundary = await evaluate(transition, {
  variation: operation("distribution", "variation", { window: 16 }),
  divergence: operation("distribution", "divergence", { window: 16 }),
});
assert.equal(boundary.results[32].raw.variation, 1);
assert.equal(boundary.results[32].raw.divergence, 1);

for (const window of [1, 7, 32, 128])
  for (let bit = 0; bit < 8; bit++) {
    const kinds = ["bias", "entropy", "count", "valid"];
    const { results } = await evaluate(
      data,
      Object.fromEntries(
        kinds.map((kind) => [kind, operation("bit", kind, { window, bit })]),
      ),
    );
    for (let i = 0; i < data.length; i++) {
      const values = data.slice(
        Math.max(0, i - Math.floor(window / 2)),
        Math.min(data.length, i + window - Math.floor(window / 2)),
      );
      const count = [...values].reduce(
        (sum, value) => sum + ((value >> bit) & 1),
        0,
      );
      close(results[i].raw.bias, count / values.length, "Bit bias");
      close(
        results[i].raw.entropy,
        binaryEntropy(count / values.length),
        "Bit entropy",
      );
      assert.equal(results[i].raw.count, count);
    }
  }

// Missing reads are distinct from measured zero; real addresses may depend on an earlier analysis.
const nested = {
  ...operation("bit", "bias", { bit: 0, window: 7 }),
  offset: {
    op: "multiply",
    a: operation("distribution", "variation", { window: 2 }),
    b: { op: "constant", value: 20 },
  },
};
const nestedResult = await evaluate(data, { nested });
for (let i = 0; i < data.length; i++) {
  const score = referenceDistribution(data, i, 2, 0).variation;
  const index = Math.floor(Math.fround(Math.fround(score) * 20));
  const values = data.slice(
    Math.max(0, index - 3),
    Math.min(data.length, index + 4),
  );
  const bias =
    [...values].reduce((sum, value) => sum + (value & 1), 0) / values.length;
  assert.equal(nestedResult.results[i].output.nested, Math.fround(bias));
}
const invalid = {
  ...operation("bit", "valid"),
  offset: { op: "constant", value: -1 },
};
const invalidResult = await evaluate(data, { invalid });
assert(invalidResult.results.every((point) => point.output.invalid === 0));

// Reuse across output projections on one immutable source does not rebuild the fitted model.
const reusableJob = fixture(data),
  reusedCache = {};
const firstProgram = compileRecipes({
  hue: operation("conditional", "probability"),
});
const first = await pointFactors(
  reusableJob,
  plain,
  reusedCache,
  () => true,
  firstProgram,
);
const fitted = reusedCache.analysisProviders.conditional.joint;
const secondProgram = compileRecipes({
  hue: operation("conditional", "surprise"),
});
await pointFactors(reusableJob, plain, reusedCache, () => true, secondProgram);
assert.equal(reusedCache.analysisProviders.conditional.joint, fitted);
assert(first);

const noAnalysis = {};
await pointFactors(fixture(data), plain, noAnalysis, () => true);
assert(
  !noAnalysis.analysisProviders,
  "Unused statistical providers were prepared",
);
await assert.rejects(
  () =>
    pointFactors(
      {
        ...fixture(data),
        configuration: { ...fixture(data).configuration, providerBudget: 1024 },
      },
      plain,
      {},
      () => true,
      firstProgram,
    ),
  /budget/,
);
let current = true;
const large = fixture(new Uint8Array(2 ** 20));
const canceledCache = {};
setTimeout(() => {
  current = false;
}, 0);
const canceled = await pointFactors(
  large,
  plain,
  canceledCache,
  () => current,
  firstProgram,
);
assert.equal(canceled, null);
assert(!canceledCache.analysisProviders);

console.log(
  "Statistical providers pass: exact scoped conditional models, raw surprise, rolling lag/MI, distribution TV/JS, shared bit windows, boundaries, nested addresses, reuse, laziness, budgets and cancellation.",
);
