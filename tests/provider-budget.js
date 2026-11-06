import assert from "node:assert/strict";
import { fourierStorage, fourierSpectrum } from "../fourier.js";
import { prepareSpectrum } from "../spectrum.js";
import { assertProviderBudget } from "../provider-budget.js";
import {
  presetConfiguration,
  validateConfiguration,
} from "../point-configuration.js";

const base = presetConfiguration("dft");
for (const invalid of [-1, 0, 0.1, NaN, Infinity, "100"])
  assert.throws(() =>
    validateConfiguration({ ...base, providerBudget: invalid }),
  );
for (const limit of [1, 1048576, null])
  assert.equal(
    validateConfiguration({ ...base, providerBudget: limit }).providerBudget,
    limit,
  );
assert.equal(fourierStorage(0), 0);
assert(fourierStorage(4093) > fourierStorage(4096));
for (const invalid of [-1, 1.2, Infinity, 2 ** 30])
  assert.throws(() => fourierStorage(invalid));
const bytes = Uint8Array.from({ length: 31 }, (_, i) => i * 3);
const job = {
  source: new Blob([bytes]),
  offset: 0,
  length: bytes.length,
  configuration: { ...base, providerBudget: 1 },
};
const cache = {};
await assert.rejects(() => prepareSpectrum(job, cache, bytes), /budget/);
assert.equal(cache.factorSpectrum, undefined);
const allowed = {
  ...job,
  configuration: { ...base, providerBudget: fourierStorage(bytes.length) },
};
const result = await prepareSpectrum(allowed, cache, bytes);
const direct = fourierSpectrum(bytes);
assert.deepEqual(result.real, direct.real.slice(0, result.real.length));
assert.deepEqual(
  result.imaginary,
  direct.imaginary.slice(0, result.imaginary.length),
);
await assert.rejects(() => prepareSpectrum(job, cache, bytes), /budget/);
assert.equal(
  cache.factorSpectrum,
  result,
  "Rejection mutated a completed spectrum",
);
assert.equal(assertProviderBudget({}, 123, "Test"), 123);
assert.throws(() => assertProviderBudget({}, Infinity, "Test"));
console.log(
  "Provider budgets pass: explicit validation, conservative transform estimates, preallocation rejection, cache atomicity and unchanged exact DFT.",
);
