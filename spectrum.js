/** Selection-scoped spectrum shared by native DFT and mixed point factors. */
import { fourierSpectrum } from './fourier.js';

export function matchingSpectrum(job, cache) {
 const spectrum = cache.factorSpectrum;
 return spectrum?.source === (job.sourceId ?? job.source) && spectrum.key === `${job.offset}/${job.length}` ? spectrum : null;
}

export function prepareSpectrum(job, cache, bytes) {
 const cached = matchingSpectrum(job, cache);
 if (cached) return cached;
 const {real, imaginary} = fourierSpectrum(bytes);
 const bins = job.length ? Math.floor(job.length / 2) + 1 : 0;
 // Consumers only use the real-input one-sided spectrum. Copy rather than
 // subarray so a small selection cannot retain Bluestein's padded work buffers.
 return cache.factorSpectrum = {
  source: job.sourceId ?? job.source, key: `${job.offset}/${job.length}`,
  real: real.slice(0, bins), imaginary: imaginary.slice(0, bins)
 };
}

export function spectrumComponents(spectrum, length, phase, amplitude) {
 const bins = length ? Math.floor(length / 2) + 1 : 0;
 if (phase && !spectrum.phases) {
  spectrum.phases = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
   const re = spectrum.real[k], im = spectrum.imaginary[k], magnitude = Math.hypot(re, im);
   const angle = Math.abs(im) < magnitude * 1e-12 ? re >= 0 ? 0 : Math.PI : Math.atan2(im, re);
   spectrum.phases[k] = (angle + Math.PI) / (2 * Math.PI);
  }
 }
 if (amplitude && !spectrum.amplitudes) {
  const values = spectrum.amplitudes = new Float64Array(bins);
  let peak = 0;
  for (let k = 0; k < bins; k++) {
   const value = Math.hypot(spectrum.real[k], spectrum.imaginary[k]) / length * (k === 0 || k * 2 === length ? 1 : 2);
   values[k] = value; peak = Math.max(peak, value);
  }
  const scale = peak ? 1 / Math.log1p(peak) : 0;
  for (let k = 0; k < bins; k++) values[k] = values[k] < peak * 1e-10 ? 0 : Math.log1p(values[k]) * scale;
 }
 return spectrum;
}
