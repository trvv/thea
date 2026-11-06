import assert from "node:assert/strict";
import { fourierSpectrum, fourierSpectrumAsync } from "../fourier.js";
import { prepareSpectrum } from "../spectrum.js";
for (const length of [0, 1, 7, 1024, 32768, 32771]) {
  const bytes = Uint8Array.from({ length }, (_, i) => (i * 71) & 255);
  assert.deepEqual(await fourierSpectrumAsync(bytes), fourierSpectrum(bytes));
}
for (const length of [131072, 131071]) {
  let active = true;
  const bytes = new Uint8Array(length);
  const cache = {};
  setTimeout(() => {
    active = false;
  }, 0);
  assert.equal(
    await prepareSpectrum(
      { source: new Blob([bytes]), offset: 0, length },
      cache,
      bytes,
      () => active,
    ),
    null,
  );
  assert.equal(cache.factorSpectrum, undefined);
}
console.log(
  "FFT cancellation passes: exact sync parity, radix-2/Bluestein task cancellation and no partial cache publication.",
);
