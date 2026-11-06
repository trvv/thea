/** On-demand source descriptions. These are derived from provider data, never stored per mark. */
import { factorIndices } from "./factor-catalog.js";
const range = (start, endExclusive) => ({ start, endExclusive });
export function sampleProvenance(job, data, factors, context) {
  const { bytes, spectrum, counts, grid, average, bins, count, available } =
    data;
  const readByte = data.readByte || ((index) => bytes?.[index]);
  const sample = context.offset,
    absolute = job.offset + sample;
  const end = average
    ? Math.floor(((context.sampleOrdinal + 1) * job.length) / count)
    : sample + 1;
  const population = job.configuration.population || "bytes";
  const bin =
    population === "bins"
      ? context.pointIndex
      : Math.min(bins - 1, Math.floor((sample * bins) / job.length));
  const selection = range(job.offset, job.offset + job.length);
  const describeByte = (index) => {
    index = Math.floor(index);
    const valid = index >= 0 && index < job.length;
    return {
      selectionOffset: index,
      sourceOffset: job.offset + index,
      value: valid ? readByte(index) : 0,
      ...(valid ? {} : { boundary: "zero outside selection" }),
    };
  };
  const describeSpectrum = (index) => {
    const result = {
      bin: index,
      binCount: bins,
      selection,
      length: job.length,
      cyclesPerByte: index / Math.max(1, job.length),
      nyquistFraction: (2 * index) / Math.max(1, job.length),
    };
    if (spectrum) {
      const real = spectrum.real[index],
        imaginary = spectrum.imaginary[index];
      const magnitude = Math.hypot(real, imaginary),
        oneSidedMultiplier = index === 0 || index * 2 === job.length ? 1 : 2;
      const angle =
        Math.abs(imaginary) < magnitude * 1e-12
          ? real >= 0
            ? 0
            : Math.PI
          : Math.atan2(imaginary, real);
      Object.assign(result, {
        real,
        imaginary,
        magnitude,
        oneSidedMultiplier,
        amplitude: (magnitude / Math.max(1, job.length)) * oneSidedMultiplier,
        phaseRadians: angle,
        normalizedPhase: (angle + Math.PI) / (2 * Math.PI),
      });
      if (spectrum.amplitudes)
        Object.assign(result, {
          normalizedAmplitude: spectrum.amplitudes[index],
          peakAmplitude: spectrum.peakAmplitude,
          amplitudeNormalization:
            "log1p(amplitude) / log1p(peak), suppress amplitudes below peak × 1e-10",
        });
    }
    return result;
  };
  const describeEntropy = (index, size) => {
    index = Math.floor(index);
    if (index < 0 || index >= job.length)
      return {
        selectionOffset: index,
        window: size,
        boundary: "zero outside selection",
      };
    const center = job.offset + index,
      start = Math.max(0, center - Math.floor(size / 2));
    const end = Math.min(job.source.size, center + size - Math.floor(size / 2));
    const values = data.rootRange
      ? data.rootRange(start, end)
      : data.window.data.subarray(
          start - data.window.start,
          end - data.window.start,
        );
    const frequencies = new Map();
    for (const byte of values)
      frequencies.set(byte, (frequencies.get(byte) || 0) + 1);
    let bits = 0;
    for (const frequency of frequencies.values()) {
      const p = frequency / values.length;
      bits -= p * Math.log2(p);
    }
    return {
      selectionOffset: index,
      sourceOffset: center,
      window: size,
      sourceRange: range(start, end),
      bytes: [...values],
      counts: Object.fromEntries(frequencies),
      shannonBits: bits,
      maximumBits: Math.min(8, Math.log2(size)),
      ...(size === 32
        ? { quantization: "round(normalized entropy × 255) / 255" }
        : {}),
    };
  };
  const describeCount = (name) => {
    const width = name === "byteCount" ? 1 : name === "pairCount" ? 2 : 3;
    const tuple = Array.from(bytes.subarray(sample, sample + width));
    const key = tuple.reduce((value, byte) => value * 256 + byte, 0);
    const histogram =
      counts?.[width === 1 ? "byte" : width === 2 ? "pair" : "triple"];
    const occurrences =
      tuple.length < width
        ? 0
        : width === 3
          ? histogram?.get(key) || 0
          : histogram?.[key] || 0;
    return {
      tuple,
      sourceOffset: absolute,
      occurrences,
      selection,
      normalization: "1 - exp(-0.25 × log1p(occurrences))",
    };
  };
  const describeFactor = (name) => {
    if (name === "value" || name === "byte1")
      return end > sample + 1
        ? {
            sourceRange: range(absolute, job.offset + end),
            sampleCount: end - sample,
            meanByteValue: factors[factorIndices.value] * 255,
            normalization: 255,
          }
        : { ...describeByte(sample), normalization: 255 };
    if (["byte2", "byte3", "previous"].includes(name))
      return {
        ...describeByte(sample + { byte2: 1, byte3: 2, previous: -1 }[name]),
        normalization: 255,
      };
    if (name === "entropy")
      return end > sample + 1
        ? {
            sourceRange: range(absolute, job.offset + end),
            sampleCount: end - sample,
            window: 32,
            haloRange: range(
              Math.max(0, absolute - 16),
              Math.min(job.source.size, job.offset + end + 15),
            ),
            maximumBits: 5,
            normalizedMean: factors[factorIndices.entropy],
            quantization: "mean of 8-bit local entropy values / 255",
          }
        : describeEntropy(sample, 32);
    if (["phase", "frequency", "amplitude"].includes(name))
      return describeSpectrum(bin);
    if (name === "count")
      return {
        factor:
          job.region === "digraph"
            ? "pairCount"
            : job.region === "trigraph"
              ? "tripleCount"
              : "byteCount",
        ...describeCount(
          job.region === "digraph"
            ? "pairCount"
            : job.region === "trigraph"
              ? "tripleCount"
              : "byteCount",
        ),
      };
    if (name.endsWith("Count")) return describeCount(name);
    if (name === "position")
      return {
        sourceOffset: absolute,
        selectionOffset: sample,
        divisor: Math.max(1, job.length - 1),
      };
    if (["column", "row", "slice"].includes(name)) {
      const capacity = grid.columns * grid.rows * grid.slices;
      const cell =
        available > capacity
          ? Math.floor((context.sampleOrdinal * capacity) / count)
          : context.pointIndex;
      return {
        cellIndex: cell,
        columns: grid.columns,
        rows: grid.rows,
        slices: grid.slices,
        dimensions: grid.dimensions,
      };
    }
    return {};
  };
  const point = {
    population,
    index: context.pointIndex,
    populationCount: context.pointCount,
    selection,
    ...(population === "bins"
      ? {
          bin: describeSpectrum(bin),
          byteCorrespondence: {
            selectionOffset: sample,
            sourceOffset: absolute,
          },
        }
      : {
          sourceOffset: absolute,
          selectionOffset: sample,
          ...(population === "bytes"
            ? {
                byteValue: readByte(sample),
                ...(end > sample + 1
                  ? {
                      sampleRange: range(absolute, job.offset + end),
                      sampleCount: end - sample,
                      meanByteValue: factors[factorIndices.value] * 255,
                    }
                  : {}),
              }
            : {
                tuple: bytes
                  ? [
                      ...bytes.subarray(
                        sample,
                        sample + (population === "pairs" ? 2 : 3),
                      ),
                    ]
                  : undefined,
                representative: `${job.configuration.tupleRepresentative || "first"} occurrence`,
              }),
        }),
  };
  return {
    point,
    describeFactor,
    describeByte,
    describeEntropy,
    describeSpectrum,
  };
}
