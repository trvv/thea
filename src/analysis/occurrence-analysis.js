/** Exact raw counts and population-relative exposure, independent of rendered sampling. */
import { scanChunkSize, mapEntryEstimate, yieldScan } from "../data/scan.js";

export function occurrenceStorage(model) {
  return (
    model.sorted.byteLength +
    (model.counts instanceof Map
      ? model.counts.size * mapEntryEstimate
      : model.counts.byteLength)
  );
}

export async function prepareOccurrence(bytes, width, current, checkBudget) {
  const alphabet = 256 ** width;
  checkBudget(width === 3 ? 0 : alphabet * 8, "Raw occurrence counts");
  const counts = width === 3 ? new Map() : new Float64Array(alphabet);
  const mask = width === 3 ? 0xffffff : width === 2 ? 0xffff : 0xff;
  let key = 0;
  for (let start = 0; start < bytes.length; start += scanChunkSize) {
    const end = Math.min(bytes.length, start + scanChunkSize);
    for (let i = start; i < end; i++) {
      key = ((key << 8) | bytes[i]) & mask;
      if (i < width - 1) continue;
      if (width === 3) {
        if (!counts.has(key))
          checkBudget(
            (counts.size + 1) * mapEntryEstimate,
            "Raw triple counts",
          );
        counts.set(key, (counts.get(key) || 0) + 1);
      } else counts[key]++;
    }
    if (end < bytes.length && !(await yieldScan(current))) return null;
  }
  const observed =
    width === 3
      ? counts.size
      : counts.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0);
  const countBytes =
    width === 3 ? counts.size * mapEntryEstimate : counts.byteLength;
  checkBudget(countBytes + observed * 16, "Occurrence percentile preparation");
  const sorted = new Float64Array(observed);
  let index = 0;
  for (const value of counts.values()) if (value > 0) sorted[index++] = value;
  sorted.sort();
  if (!current()) return null;
  return {
    width,
    alphabet,
    counts,
    observed,
    sorted,
    total: Math.max(0, bytes.length - width + 1),
  };
}

export function countReference(model, parameters) {
  if (parameters.reference === "fixed") return parameters.referenceValue;
  const zeroes = parameters.includeZero ? model.alphabet - model.observed : 0;
  const size = zeroes + model.observed;
  if (!size) return 0;
  const rank = Math.max(
    0,
    Math.min(size - 1, Math.ceil(parameters.percentile * size) - 1),
  );
  return rank < zeroes ? 0 : model.sorted[rank - zeroes];
}

export function occurrenceResult(bytes, index, parameters, model) {
  index = Math.floor(index);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > bytes.length - model.width
  )
    return 0;
  if (parameters.kind === "valid") return 1;
  let key = 0;
  for (let i = 0; i < model.width; i++) key = key * 256 + bytes[index + i];
  const count =
    model.counts instanceof Map
      ? model.counts.get(key) || 0
      : model.counts[key];
  if (parameters.kind === "count") return count;
  if (parameters.kind === "probability")
    return model.total ? count / model.total : 0;
  const reference = countReference(model, parameters);
  const denominator = Math.log1p(parameters.compression * reference);
  return denominator > 0
    ? (Math.log1p(parameters.compression * count) / denominator) *
        parameters.exposure
    : 0;
}

export function describeOccurrence(bytes, index, parameters, model) {
  index = Math.floor(index);
  const valid =
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index <= bytes.length - model.width;
  const reference = countReference(model, parameters);
  const count = occurrenceResult(
    bytes,
    index,
    { ...parameters, kind: "count" },
    model,
  );
  return {
    ...parameters,
    valid,
    tuple: valid ? [...bytes.subarray(index, index + model.width)] : undefined,
    count,
    validTupleStarts: model.total,
    probability: model.total ? count / model.total : 0,
    referenceCount: reference,
    referenceValid: reference > 0,
    alphabetSize: model.alphabet,
    observedSymbols: model.observed,
    percentilePolicy:
      "nearest rank over exact selected counts; implicit zero categories included only when requested",
    exposureValue: occurrenceResult(
      bytes,
      index,
      { ...parameters, kind: "exposure" },
      model,
    ),
    normalization:
      "log1p(compression * count) / log1p(compression * referenceCount) * exposure; zero reference returns zero",
    ...(valid ? {} : { boundary: "incomplete tuple outside selection" }),
  };
}
