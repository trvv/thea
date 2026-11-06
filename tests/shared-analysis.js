import assert from "node:assert/strict";
import { providerPages } from "../provider-pages.js";
import { sharedAnalysisFor } from "../shared-analysis.js";
import { prepareSpectrum } from "../spectrum.js";
import { createProviderDiagnostics } from "../provider-diagnostics.js";
const bytes = Uint8Array.from({ length: 200000 }, (_, i) => (i * 71) & 255);
const source = new Blob([bytes]);
const sharedAnalysis = sharedAnalysisFor(source);
const left = { sharedAnalysis },
  right = { sharedAnalysis };
const diagnostics = createProviderDiagnostics({ diagnostics: true });
const a = providerPages(left, source, 1),
  b = providerPages(right, source, 99);
const [first, second] = await Promise.all([
  a.range(100, 100000, 32, diagnostics, () => true),
  b.range(100, 100000, 32, diagnostics, () => true),
]);
assert.deepEqual(first, second);
assert.equal(left.providerPages, right.providerPages);
assert.ok(diagnostics.source.bytes <= source.size);
const warm = createProviderDiagnostics({ diagnostics: true });
await b.range(100, 100000, 32, warm, () => true);
assert.equal(warm.source.reads, 0);
const samples = bytes.subarray(0, 131071);
const base = { source, offset: 0, length: samples.length };
let active = true;
const canceled = prepareSpectrum(
  { ...base, sourceId: 1 },
  left,
  samples,
  () => active,
);
const surviving = prepareSpectrum({ ...base, sourceId: 99 }, right, samples);
active = false;
assert.equal(await canceled, null);
const spectrum = await surviving;
const again = await prepareSpectrum(
  { ...base, sourceId: 100 },
  { sharedAnalysis },
  samples,
);
assert.equal(spectrum.real, again.real);
assert.equal(spectrum.imaginary, again.imaginary);
assert.equal(sharedAnalysis.spectra.size, 1);
assert.equal(
  sharedAnalysis.spectrumBytes,
  spectrum.real.byteLength + spectrum.imaginary.byteLength,
);
assert.notEqual(sharedAnalysisFor(new Blob([bytes])), sharedAnalysis);
console.log(
  "Shared analysis passes: source identity, concurrent page deduplication, warm reads, shared spectra and independently canceled waiters.",
);
