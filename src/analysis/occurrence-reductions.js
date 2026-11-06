/** Reduce actual measurements at every matching tuple occurrence, without retaining addresses. */
import { scanChunkSize, mapEntryEstimate, yieldScan } from "../data/scan.js";

const tripleEntryBytes = mapEntryEstimate + 64;

export function reductionStorage(model) {
  return model.counts instanceof Map
    ? model.counts.size * tripleEntryBytes
    : model.counts.byteLength + model.sums.byteLength;
}

/**
 * Entropy neighborhoods use only selected bytes. The rolling histogram is identical to
 * windowEntropy, while the output feeds tuple sums directly instead of a source-length array.
 */
export async function prepareReduction(
  bytes,
  parameters,
  current,
  checkBudget,
) {
  const { width, window } = parameters;
  const temporary = 256 * 4 + (window + 1) * 8;
  const fixed = width === 2 ? 65536 * 8 * 2 : 0;
  checkBudget(fixed + temporary, "Occurrence reduction preparation");
  const counts = width === 2 ? new Float64Array(65536) : new Map();
  const sums = width === 2 ? new Float64Array(65536) : undefined;
  const histogram = new Uint32Array(256);
  const weights = Float64Array.from({ length: window + 1 }, (_, count) =>
    count ? count * Math.log2(count) : 0,
  );
  const maximum = Math.min(8, Math.log2(window));
  let left = 0,
    right = 0,
    entropySum = 0;
  const update = (byte, delta) => {
    const count = histogram[byte];
    entropySum += weights[count + delta] - weights[count];
    histogram[byte] += delta;
  };
  for (let start = 0; start < bytes.length; start += scanChunkSize) {
    const end = Math.min(bytes.length, start + scanChunkSize);
    for (let index = start; index < end; index++) {
      const first = Math.max(0, index - Math.floor(window / 2));
      const last = Math.min(
        bytes.length,
        index + window - Math.floor(window / 2),
      );
      while (left < first) update(bytes[left++], -1);
      while (right < last) update(bytes[right++], 1);
      if (index + width > bytes.length) continue;
      const length = right - left;
      const normalized = maximum
        ? Math.max(
            0,
            Math.min(1, (Math.log2(length) - entropySum / length) / maximum),
          )
        : 0;
      const value =
        window === 32 ? Math.round(normalized * 255) : Math.fround(normalized);
      const key =
        width === 2
          ? bytes[index] * 256 + bytes[index + 1]
          : bytes[index] * 65536 + bytes[index + 1] * 256 + bytes[index + 2];
      if (width === 2) {
        counts[key]++;
        sums[key] += value;
      } else {
        let aggregate = counts.get(key);
        if (!aggregate) {
          checkBudget(
            (counts.size + 1) * tripleEntryBytes + temporary,
            "Occurrence reduction index",
          );
          aggregate = [0, 0];
          counts.set(key, aggregate);
        }
        aggregate[0]++;
        aggregate[1] += value;
      }
    }
    if (end < bytes.length && !(await yieldScan(current))) return null;
  }
  if (!current()) return null;
  return { width, window, counts, sums };
}

export function reductionValues(bytes, index, model) {
  index = Math.floor(index);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > bytes.length - model.width
  )
    return { count: 0, sum: 0, mean: 0, valid: false };
  const key =
    model.width === 2
      ? bytes[index] * 256 + bytes[index + 1]
      : bytes[index] * 65536 + bytes[index + 1] * 256 + bytes[index + 2];
  const count =
    model.width === 2 ? model.counts[key] : model.counts.get(key)?.[0] || 0;
  const rawSum =
    model.width === 2 ? model.sums[key] : model.counts.get(key)?.[1] || 0;
  const sum = model.window === 32 ? rawSum / 255 : rawSum;
  return { count, sum, mean: count ? sum / count : 0, valid: count > 0 };
}

/** Scalar visitor path; do not allocate provenance objects for rendered marks. */
export function reductionResult(bytes, index, parameters, model) {
  index = Math.floor(index);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > bytes.length - model.width
  )
    return 0;
  const key =
    model.width === 2
      ? bytes[index] * 256 + bytes[index + 1]
      : bytes[index] * 65536 + bytes[index + 1] * 256 + bytes[index + 2];
  const count =
    model.width === 2 ? model.counts[key] : model.counts.get(key)?.[0] || 0;
  if (parameters.kind === "count") return count;
  if (parameters.kind === "valid") return count ? 1 : 0;
  const rawSum =
    model.width === 2 ? model.sums[key] : model.counts.get(key)?.[1] || 0;
  const sum = model.window === 32 ? rawSum / 255 : rawSum;
  return parameters.kind === "sum" ? sum : count ? sum / count : 0;
}

export function describeReduction(bytes, index, parameters, model) {
  const values = reductionValues(bytes, index, model);
  return {
    ...parameters,
    ...values,
    tuple: values.valid
      ? [...bytes.subarray(index, index + model.width)]
      : undefined,
    neighborhoodScope: "selection",
    reduction:
      "arithmetic mean of local entropy at every complete matching tuple start",
    units: "normalized entropy using min(8, log2(requested window))",
    maximumBits: Math.min(8, Math.log2(model.window)),
    quantization:
      model.window === 32
        ? "sum 8-bit local entropy values, then divide by 255"
        : "sum Float32 local entropy values",
    ...(values.valid ? {} : { boundary: "incomplete tuple outside selection" }),
  };
}
