/** Selection-scoped spectrum shared by all point populations. */
import { fourierSpectrumAsync, fourierStorage } from "./fourier.js";
import { assertProviderBudget } from "./provider-budget.js";

export function matchingSpectrum(job, cache) {
  const spectrum = cache.factorSpectrum;
  return spectrum?.source === (job.sourceId ?? job.source) &&
    spectrum.key === `${job.offset}/${job.length}`
    ? spectrum
    : null;
}

export async function prepareSpectrum(job, cache, bytes, current = () => true) {
  assertProviderBudget(job, fourierStorage(job.length), "DFT preparation");
  const cached = matchingSpectrum(job, cache);
  if (cached) return cached;
  const shared = cache.sharedAnalysis;
  const key = `${job.offset}/${job.length}`;
  let entry = shared?.spectra.get(key);
  const waiter = { current };
  if (!entry) {
    entry = { waiters: new Set([waiter]) };
    entry.promise = (async () => {
      const result = await fourierSpectrumAsync(bytes, () =>
        [...entry.waiters].some((consumer) => consumer.current()),
      );
      if (!result) return null;
      const bins = job.length ? Math.floor(job.length / 2) + 1 : 0;
      return {
        real: result.real.slice(0, bins),
        imaginary: result.imaginary.slice(0, bins),
      };
    })();
    shared?.spectra.set(key, entry);
  } else entry.waiters.add(waiter);
  let result;
  try {
    result = await entry.promise;
  } catch (error) {
    if (shared?.spectra.get(key) === entry) shared.spectra.delete(key);
    throw error;
  } finally {
    entry.waiters.delete(waiter);
  }
  if (shared && !entry.accounted) {
    if (!result) shared.spectra.delete(key);
    else {
      entry.accounted = result.real.byteLength + result.imaginary.byteLength;
      shared.spectrumBytes += entry.accounted;
      for (const [cachedKey, cachedEntry] of shared.spectra) {
        if (shared.spectrumBytes <= 32 * 1048576) break;
        if (!cachedEntry.accounted) continue;
        shared.spectra.delete(cachedKey);
        shared.spectrumBytes -= cachedEntry.accounted;
      }
    }
  }
  if (!result || !current()) return null;
  return (cache.factorSpectrum = {
    source: job.sourceId ?? job.source,
    key,
    ...result,
  });
}

export function spectrumComponents(spectrum, length, phase, amplitude) {
  const bins = length ? Math.floor(length / 2) + 1 : 0;
  if (phase && !spectrum.phases) {
    spectrum.phases = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const re = spectrum.real[k],
        im = spectrum.imaginary[k],
        magnitude = Math.hypot(re, im);
      const angle =
        Math.abs(im) < magnitude * 1e-12
          ? re >= 0
            ? 0
            : Math.PI
          : Math.atan2(im, re);
      spectrum.phases[k] = (angle + Math.PI) / (2 * Math.PI);
    }
  }
  if (amplitude && !spectrum.amplitudes) {
    const values = (spectrum.amplitudes = new Float64Array(bins));
    let peak = 0;
    for (let k = 0; k < bins; k++) {
      const value =
        (Math.hypot(spectrum.real[k], spectrum.imaginary[k]) / length) *
        (k === 0 || k * 2 === length ? 1 : 2);
      values[k] = value;
      peak = Math.max(peak, value);
    }
    spectrum.peakAmplitude = peak;
    const scale = peak ? 1 / Math.log1p(peak) : 0;
    for (let k = 0; k < bins; k++)
      values[k] = values[k] < peak * 1e-10 ? 0 : Math.log1p(values[k]) * scale;
  }
  return spectrum;
}
