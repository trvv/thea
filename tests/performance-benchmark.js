import { fourierSpectrum, fourierSpectrumAsync } from "../fourier.js";
// Non-gating before/after tuple measurements. Optional checkout path supplies the reference.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { populationOffsets } from "../populations.js";
import { createProviderDiagnostics } from "../provider-diagnostics.js";
const reference = process.argv[2]
  ? (
      await import(
        new URL("populations.js", pathToFileURL(resolve(process.argv[2]) + "/"))
      )
    ).populationOffsets
  : null;
let seed = 123;
const random = Uint8Array.from({ length: 1048576 }, () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed >>> 24;
});
for (const repeated of [false, true]) {
  const source = new Blob([
    repeated ? Uint8Array.from(random, (_, index) => index % 4) : random,
  ]);
  for (const population of ["pairs", "triples"]) {
    for (const [implementation, prepare] of [
      ["current", populationOffsets],
      ...(reference ? [["reference", reference]] : []),
    ]) {
      const cache = {},
        times = [],
        readBytes = [];
      for (let frame = 0; frame < 25; frame++) {
        const diagnostics = createProviderDiagnostics({ diagnostics: true });
        const start = performance.now();
        await prepare(
          {
            source,
            offset: frame * 32,
            length: 262144,
            configuration: { population },
          },
          undefined,
          cache,
          () => true,
          diagnostics,
        );
        if (frame > 4) {
          times.push(performance.now() - start);
          readBytes.push(diagnostics.source.bytes);
        }
      }
      const median = (values) =>
        values.sort((a, b) => a - b)[values.length >> 1];
      console.log({
        implementation,
        repeated,
        population,
        milliseconds: median(times),
        sourceBytes: median(readBytes),
        incremental: !!cache.tupleIndex?.incremental,
      });
    }
  }
}

// Include cooperative scheduling overhead rather than timing only synchronous FFT kernels.
const referenceFFT = process.argv[2]
  ? (
      await import(
        new URL("fourier.js", pathToFileURL(resolve(process.argv[2]) + "/"))
      )
    ).fourierSpectrum
  : null;
for (const length of [4096, 65536, 65537, 1048576]) {
  const samples = Uint8Array.from({ length }, (_, index) => index & 255);
  for (const [implementation, transform] of [
    ["current-sync", fourierSpectrum],
    ["current-async", fourierSpectrumAsync],
    ...(referenceFFT ? [["reference", referenceFFT]] : []),
  ]) {
    const times = [];
    for (let iteration = 0; iteration < 8; iteration++) {
      const started = performance.now();
      await transform(samples);
      if (iteration > 2) times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    console.log({
      implementation,
      transformLength: length,
      milliseconds: times[times.length >> 1],
    });
  }
}
