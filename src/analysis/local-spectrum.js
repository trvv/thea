/** Demand-selected local frames; coefficients are temporary, cached results are small power reductions. */
import { fourierSpectrum, fourierStorage } from "./fourier.js";
import { mapEntryEstimate, yieldScan } from "../data/scan.js";

/** Latest frame start at/before a selection-relative byte; origins never depend on render geometry. */
export const spectralFrameStart = (index, parameters) =>
  parameters.origin +
  Math.floor((index - parameters.origin) / parameters.hop) * parameters.hop;

export function localFrame(bytes, parameters, start) {
  const length = parameters.window;
  const end = start + length;
  const first = Math.max(0, start),
    last = Math.min(bytes.length, end);
  const count = Math.max(0, last - first);
  if (
    !count ||
    (parameters.edge === "omit" && (start < 0 || end > bytes.length))
  )
    return { result: [0, 0, 0, 0, start, end, count, -1, -1] };
  let mean = 0;
  if (parameters.preprocessing === "mean") {
    for (let index = first; index < last; index++) mean += bytes[index];
    mean /= count;
  }
  const samples = new Float64Array(length);
  for (let index = first; index < last; index++) {
    const position = index - start;
    const value =
      bytes[index] -
      (parameters.preprocessing === "mean"
        ? mean
        : parameters.preprocessing === "centered"
          ? 127.5
          : 0);
    const weight =
      parameters.taper === "hann"
        ? 0.5 - 0.5 * Math.cos((2 * Math.PI * position) / length)
        : 1;
    samples[position] = value * weight;
  }
  const { real, imaginary } = fourierSpectrum(samples);
  let peakPower = 0;
  for (let bin = 0; bin <= Math.floor(length / 2); bin++)
    peakPower = Math.max(peakPower, real[bin] ** 2 + imaginary[bin] ** 2);
  let bandPower = 0,
    totalPower = 0,
    firstBin = -1,
    lastBin = -1;
  for (let bin = parameters.dc ? 0 : 1; bin <= Math.floor(length / 2); bin++) {
    const coefficientPower = real[bin] ** 2 + imaginary[bin] ** 2;
    const power =
      coefficientPower < peakPower * 1e-20
        ? 0
        : coefficientPower * (bin === 0 || bin * 2 === length ? 1 : 2);
    totalPower += power;
    if (bin / length >= parameters.low && bin / length <= parameters.high) {
      bandPower += power;
      if (firstBin < 0) firstBin = bin;
      lastBin = bin;
    }
  }
  return {
    result: [
      totalPower > 0 ? Math.max(0, Math.min(1, bandPower / totalPower)) : 0,
      totalPower > 0 ? 1 : 0,
      bandPower,
      totalPower,
      start,
      end,
      count,
      firstBin,
      lastBin,
    ],
    real,
    imaginary,
    samples,
  };
}

export async function prepareLocalSpectra(
  bytes,
  parameters,
  indices,
  current = () => true,
  checkBudget = () => {},
) {
  const frames = new Map(),
    results = new Map();
  let preparedFrames = 0;
  for (const index of indices) {
    if (!current()) return null;
    const start = spectralFrameStart(index, parameters);
    let result = frames.get(start);
    if (!result) {
      checkBudget(
        (frames.size + results.size + 1) * (mapEntryEstimate + 9 * 8) +
          fourierStorage(parameters.window) +
          parameters.window * 8,
        "Local spectrum frame",
      );
      result = localFrame(bytes, parameters, start).result;
      frames.set(start, result);
      preparedFrames++;
      if (preparedFrames % 16 === 0 && !(await yieldScan(current))) return null;
    }
    checkBudget(
      (frames.size + results.size + 1) * (mapEntryEstimate + 9 * 8),
      "Local spectrum results",
    );
    results.set(index, result);
  }
  return current() ? results : null;
}
