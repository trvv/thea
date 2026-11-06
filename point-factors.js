/**
 * Lazy window providers and per-sample inputs. File-relative reads, selection-relative recipe
 * offsets, and normalized spectrum positions have distinct contracts.
 * @module point-factors
 * @see docs/recipes.md
 */
import { byteCharacter } from "./text.js";
import { recordProvider, readProviderBytes } from "./provider-diagnostics.js";
import { windowEntropy, entropyShading } from "./entropy.js";
export { windowEntropy } from "./entropy.js";
import { pointGrid, gridCoordinates } from "./dimensions.js";
import { compileRecipes, recipeRoots } from "./recipes.js";
import { factorCount, factorIndices as slots } from "./factors.js";
import { occurrenceFactor } from "./appearance.js";
import { prepareSpectrum, spectrumComponents } from "./spectrum.js";
import { windowCounts } from "./histograms.js";
import { populationOffsets, defaultSampleLimit } from "./populations.js";

// Providers are selected from the active channels, including only visible axes.
// Each cache holds one window; camera/style changes reuse the selected data.
/**
 * Prepare only reachable providers, then expose a visitor over population points with selection-relative byte offsets. A recipe
 * context uses selection-relative offsets; halo reads for entropy remain file-relative.
 * @param {object} cache One mutable cache owner per canvas/thread; stable sourceId survives Blob
 *   cloning.
 * @param {function(): boolean} current Checked after awaited reads before publishing new cache
 *   contents.
 * @returns {Promise<function|null>} Visitor that reuses its factor array and context; consumers
 *   must copy values they retain.
 */
export async function pointFactors(
  job,
  appearance,
  cache,
  current,
  compiled,
  diagnostics,
) {
  const config = job.configuration;
  const program =
    compiled || compileRecipes(recipeRoots(config, appearance), config.recipes);
  const used = new Set(program.required);
  if (job.shaders.includes("character") || job.shaders.includes("hex"))
    used.add("value");
  const source = job.sourceId ?? job.source,
    key = `${job.offset}/${job.length}`;
  const population = config.population || "bytes";
  const tuples = population === "pairs" || population === "triples";
  const entropy = used.has("entropy");
  const windows = new Set(program.providers.entropy);
  if (entropy) windows.add(32);
  const padding = Math.max(
    0,
    ...[...windows].map((size) => Math.floor(size / 2)),
  );
  const afterPadding = Math.max(
    0,
    ...[...windows].map((size) => size - Math.floor(size / 2) - 1),
  );
  const legacyCount = used.has("count");
  const byteCounts =
    used.has("byteCount") ||
    (legacyCount && !["digraph", "trigraph"].includes(job.region));
  const pairCounts =
    used.has("pairCount") || (legacyCount && job.region === "digraph");
  const tripleCounts =
    used.has("tripleCount") || (legacyCount && job.region === "trigraph");
  const phase = used.has("phase") || program.providers.spectrum.has("phase"),
    amplitude =
      used.has("amplitude") || program.providers.spectrum.has("amplitude");
  const needBytes =
    tuples ||
    program.providers.byte ||
    windows.size > 0 ||
    phase ||
    amplitude ||
    byteCounts ||
    pairCounts ||
    tripleCounts ||
    ["value", "byte1", "byte2", "byte3", "previous"].some((factor) =>
      used.has(factor),
    );
  let bytes, metrics, spectrum, amplitudes, phases;
  let counts;
  const matches = (entry) => entry?.source === source && entry.key === key;
  if (needBytes) {
    const readStarted = diagnostics ? performance.now() : 0;
    let rebuilt = false;
    const start = Math.max(0, job.offset - padding);
    const end = Math.min(
      job.source.size,
      job.offset + job.length + afterPadding,
    );
    let window = cache.factorWindow;
    if (!matches(window) || window.start > start || window.end < end) {
      const data = await readProviderBytes(job.source, start, end, diagnostics);
      rebuilt = true;
      if (!current()) return null;
      if (data.length < job.length + job.offset - start)
        throw new Error("Byte source ended before its declared size.");
      window = cache.factorWindow = { source, key, start, end, data };
    }
    bytes = window.data.subarray(
      job.offset - window.start,
      job.offset - window.start + job.length,
    );
    recordProvider(diagnostics, "bytes", readStarted, rebuilt);
    if (windows.has(32)) {
      const entropyStarted = diagnostics ? performance.now() : 0;
      const entropyRebuilt = !matches(cache.factorEntropy);
      if (entropyRebuilt)
        cache.factorEntropy = {
          source,
          key,
          values: entropyShading(window.data).subarray(
            job.offset - window.start,
            job.offset - window.start + job.length,
          ),
        };
      recordProvider(
        diagnostics,
        "entropy:32:quantized",
        entropyStarted,
        entropyRebuilt,
      );
      metrics = cache.factorEntropy.values;
    }
  }
  if (windows.size) {
    if (!matches(cache.recipeEntropy))
      cache.recipeEntropy = { source, key, values: new Map() };
    for (const size of windows) {
      const started = diagnostics ? performance.now() : 0;
      const rebuilt = !cache.recipeEntropy.values.has(size);
      if (rebuilt) {
        if (size === 32)
          cache.recipeEntropy.values.set(
            size,
            Float32Array.from(metrics, (value) => value / 255),
          );
        else {
          const window = cache.factorWindow;
          const normalized = windowEntropy(window.data, size);
          const first = job.offset - window.start;
          cache.recipeEntropy.values.set(
            size,
            normalized.slice(first, first + job.length),
          );
        }
      }
      recordProvider(diagnostics, `entropy:${size}`, started, rebuilt);
    }
  }

  if (byteCounts || pairCounts || tripleCounts) {
    if (!matches(cache.factorCounts)) cache.factorCounts = { source, key };
    counts = cache.factorCounts;
    for (const [name, width, needed] of [
      ["byte", 1, byteCounts],
      ["pair", 2, pairCounts],
      ["triple", 3, tripleCounts],
    ]) {
      if (!needed) continue;
      const started = diagnostics ? performance.now() : 0;
      const histogram = await windowCounts(
        job,
        cache,
        width,
        current,
        bytes,
        diagnostics,
      );
      if (!histogram || !current()) return null;
      recordProvider(diagnostics, `counts:${name}`, started, histogram.read);
      counts[name] = histogram.counts;
    }
  }
  const bins = job.length ? Math.floor(job.length / 2) + 1 : 0;
  if (phase || amplitude) {
    const started = diagnostics ? performance.now() : 0;
    const rebuilt = !matches(cache.factorSpectrum);
    spectrum = prepareSpectrum(job, cache, bytes);
    recordProvider(diagnostics, "spectrum", started, rebuilt);
    const componentsStarted = diagnostics ? performance.now() : 0;
    const componentsRebuilt =
      (phase && !spectrum.phases) || (amplitude && !spectrum.amplitudes);
    spectrumComponents(spectrum, job.length, phase, amplitude);
    recordProvider(
      diagnostics,
      "spectrum:components",
      componentsStarted,
      componentsRebuilt,
    );
    phases = spectrum.phases;
    amplitudes = spectrum.amplitudes;
  }
  if (!current()) return null;
  const { columns, rows } = job.sampleLayout;
  const populationStarted = diagnostics ? performance.now() : 0;
  const previousPopulation = cache.population;
  const offsets = populationOffsets(job, bytes, cache);
  if (tuples)
    recordProvider(
      diagnostics,
      "population",
      populationStarted,
      cache.population !== previousPopulation,
    );
  const available = offsets
    ? offsets.length
    : population === "bins"
      ? bins
      : job.length;
  const pointCount = available;
  const grid = pointGrid(config, pointCount, job.sampleLayout),
    coordinates = new Float64Array(3);
  const limit =
    config.sampleLimit === null
      ? Infinity
      : (config.sampleLimit ?? defaultSampleLimit);
  const count = Math.min(
    available,
    limit,
    columns * rows,
    grid.columns * grid.rows * grid.slices,
  );
  const layout = used.has("column") || used.has("row") || used.has("slice");
  const text = job.shaders.includes("character") || job.shaders.includes("hex");
  const values = new Float64Array(Math.max(factorCount, program.factorCount));
  const context = {
    offset: 0,
    length: job.length,
    pointIndex: 0,
    pointCount,
    grid: [grid.columns, grid.rows, grid.slices],
    byte(index) {
      index = Math.floor(index);
      return index >= 0 && index < job.length ? bytes[index] : 0;
    },
    entropy(index, size) {
      index = Math.floor(index);
      return index >= 0 && index < job.length
        ? cache.recipeEntropy.values.get(size)[index]
        : 0;
    },
    spectrum(kind, position) {
      if (!bins) return 0;
      const bin = Math.min(
        bins - 1,
        Math.floor(Math.max(0, Math.min(1, position)) * bins),
      );
      return kind === "frequency"
        ? (2 * bin) / Math.max(1, job.length)
        : kind === "phase"
          ? phases[bin]
          : amplitudes[bin];
    },
  };
  const nextByte = used.has("byte2"),
    thirdByte = used.has("byte3"),
    previousByte = used.has("previous"),
    frequency = used.has("frequency");
  const average =
    population === "bytes" &&
    !text &&
    config.sampling !== "representative" &&
    job.length > count &&
    (used.has("value") || entropy);
  const visit = (emit, first = 0, last = count) => {
    for (let i = first; i < Math.min(count, last); i++) {
      const index = Math.floor((i * available) / count);
      const sample = offsets
        ? offsets[index]
        : population === "bins"
          ? Math.floor((index * job.length) / bins)
          : Math.floor((i * job.length) / count);
      if (sample >= job.length) continue;
      let value = bytes?.[sample] ?? 0,
        metric = metrics?.[sample] ?? 0;
      if (average) {
        const end = Math.floor(((i + 1) * job.length) / count);
        value = metric = 0;
        for (let j = sample; j < end; j++) {
          value += bytes?.[j] ?? 0;
          metric += metrics?.[j] ?? 0;
        }
        value /= end - sample;
        metric /= end - sample;
      }
      values[slots.value] = value / 255;
      values[slots.entropy] = metric / 255;
      values[slots.position] = sample / Math.max(1, job.length - 1);
      const pointIndex = population === "bytes" ? sample : index;
      if (layout) {
        const cellIndex =
          available > grid.columns * grid.rows * grid.slices
            ? Math.floor((i * grid.columns * grid.rows * grid.slices) / count)
            : pointIndex;
        gridCoordinates(cellIndex, grid, coordinates);
        values[slots.column] = coordinates[0];
        values[slots.row] = coordinates[1];
        values[slots.slice] = coordinates[2];
      }
      if (nextByte) values[slots.byte2] = (bytes[sample + 1] ?? 0) / 255;
      if (thirdByte) values[slots.byte3] = (bytes[sample + 2] ?? 0) / 255;
      if (previousByte) values[slots.previous] = (bytes[sample - 1] ?? 0) / 255;
      if (byteCounts)
        values[slots.byteCount] = occurrenceFactor(counts.byte[bytes[sample]]);
      if (pairCounts)
        values[slots.pairCount] =
          sample + 1 < job.length
            ? occurrenceFactor(
                counts.pair[bytes[sample] * 256 + bytes[sample + 1]],
              )
            : 0;
      if (tripleCounts)
        values[slots.tripleCount] =
          sample + 2 < job.length
            ? occurrenceFactor(
                counts.triple.get(
                  bytes[sample] * 65536 +
                    bytes[sample + 1] * 256 +
                    bytes[sample + 2],
                ) || 0,
              )
            : 0;
      if (legacyCount)
        values[slots.count] =
          values[
            job.region === "trigraph"
              ? slots.tripleCount
              : job.region === "digraph"
                ? slots.pairCount
                : slots.byteCount
          ];
      // The one-sided spectrum spans the same normalized offset as the byte samples.
      const bin =
        population === "bins"
          ? index
          : Math.min(bins - 1, Math.floor((sample * bins) / job.length));
      if (frequency)
        values[slots.frequency] = (2 * bin) / Math.max(1, job.length);
      if (phase) values[slots.phase] = phases[bin];
      if (amplitude) values[slots.amplitude] = amplitudes[bin];
      const label = !text
        ? undefined
        : job.shaders.includes("hex")
          ? bytes[sample].toString(16).padStart(2, "0").toUpperCase()
          : byteCharacter(
              bytes[sample],
              job.encoding,
              job.blankSpaces,
              job.blankNulls,
            );
      context.offset = sample;
      context.pointIndex = pointIndex;
      context.sampleOrdinal = i;
      emit(values, label, context);
    }
  };
  visit.grid = grid;
  visit.count = count;
  visit.provenance = {
    window: needBytes ? cache.factorWindow : undefined,
    bytes,
    spectrum,
    counts,
    grid,
    average,
    bins,
    pointCount,
    count,
    available,
  };
  return visit;
}
