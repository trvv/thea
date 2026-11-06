import { yieldScan } from "../data/scan.js";
/**
 * Selection-length DFTs without changing the signal by padding it. Working convolution buffers may
 * be larger; the returned spectrum still has exactly N bins.
 * @module fourier
 */
// In-place radix-2 FFT. The inverse includes its 1/N normalization.
/**
 * Mutate reusable complex buffers instead of allocating values per butterfly; inverse normalization
 * belongs here so convolution callers do not double-scale.
 */
const fftBatch = 65536;

function permute(real, imaginary, first, last, j) {
  for (let i = first; i < last; i++) {
    let bit = real.length / 2;
    for (; j & bit; bit /= 2) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  return j;
}

function butterflyBlocks(
  real,
  imaginary,
  size,
  first,
  last,
  stepReal,
  stepImaginary,
) {
  for (let start = first; start < last; start += size) {
    let rotationReal = 1,
      rotationImaginary = 0;
    for (let i = start; i < start + size / 2; i++) {
      const j = i + size / 2;
      const re = real[j] * rotationReal - imaginary[j] * rotationImaginary;
      const im = real[j] * rotationImaginary + imaginary[j] * rotationReal;
      real[j] = real[i] - re;
      imaginary[j] = imaginary[i] - im;
      real[i] += re;
      imaginary[i] += im;
      const next = rotationReal * stepReal - rotationImaginary * stepImaginary;
      rotationImaginary =
        rotationReal * stepImaginary + rotationImaginary * stepReal;
      rotationReal = next;
    }
  }
}

function butterflyRange(
  real,
  imaginary,
  first,
  last,
  half,
  stepReal,
  stepImaginary,
  rotationReal,
  rotationImaginary,
) {
  for (let i = first; i < last; i++) {
    const j = i + half;
    const re = real[j] * rotationReal - imaginary[j] * rotationImaginary;
    const im = real[j] * rotationImaginary + imaginary[j] * rotationReal;
    real[j] = real[i] - re;
    imaginary[j] = imaginary[i] - im;
    real[i] += re;
    imaginary[i] += im;
    const next = rotationReal * stepReal - rotationImaginary * stepImaginary;
    rotationImaginary =
      rotationReal * stepImaginary + rotationImaginary * stepReal;
    rotationReal = next;
  }
  return [rotationReal, rotationImaginary];
}

function normalizeComplex(real, imaginary, first, last) {
  for (let i = first; i < last; i++) {
    real[i] /= real.length;
    imaginary[i] /= real.length;
  }
}

function* fft(real, imaginary, inverse = false) {
  const length = real.length;
  let permutation = 0;
  for (let first = 1; first < length; first += fftBatch) {
    permutation = permute(
      real,
      imaginary,
      first,
      Math.min(length, first + fftBatch),
      permutation,
    );
    if (length > fftBatch) yield;
  }
  for (let size = 2; size <= length; size *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const stepReal = Math.cos(angle),
      stepImaginary = Math.sin(angle);
    if (size / 2 <= fftBatch) {
      const span = Math.max(size, Math.floor(fftBatch / (size / 2)) * size);
      for (let first = 0; first < length; first += span) {
        butterflyBlocks(
          real,
          imaginary,
          size,
          first,
          Math.min(length, first + span),
          stepReal,
          stepImaginary,
        );
        if (length > fftBatch) yield;
      }
    } else {
      for (let start = 0; start < length; start += size) {
        let rotationReal = 1,
          rotationImaginary = 0;
        for (let first = start; first < start + size / 2; first += fftBatch) {
          [rotationReal, rotationImaginary] = butterflyRange(
            real,
            imaginary,
            first,
            Math.min(start + size / 2, first + fftBatch),
            size / 2,
            stepReal,
            stepImaginary,
            rotationReal,
            rotationImaginary,
          );
          yield;
        }
      }
    }
  }
  if (inverse) {
    for (let first = 0; first < length; first += fftBatch) {
      const end = Math.min(length, first + fftBatch);
      normalizeComplex(real, imaginary, first, end);
      if (length > fftBatch) yield;
    }
  }
}

/**
 * Distinguish radix-2 input from Bluestein working size; padding the input itself would move the
 * frequencies being inspected.
 */
function transformSize(length) {
  const radix2 = length > 0 && Number.isInteger(Math.log2(length));
  return {
    size: radix2
      ? length
      : 2 ** Math.ceil(Math.log2(Math.max(1, length * 2 - 1))),
    radix2,
  };
}

/**
 * Account for Bluestein's extra transforms in offloading decisions; nearly equal selection lengths
 * can have very different costs.
 */
export function fourierCost(length) {
  const { size, radix2 } = transformSize(length);
  return (
    size * Math.log2(size) * (radix2 ? 8 : 24) + length * (radix2 ? 2 : 24)
  );
}

/** Conservative live typed storage: input, transform workspace and one-sided result/components. */
export function fourierStorage(length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > 2 ** 29)
    throw new RangeError("Unsupported transform length");
  if (!length) return 0;
  const { size, radix2 } = transformSize(length);
  const bins = Math.floor(length / 2) + 1;
  return length + size * (radix2 ? 16 : 32) + bins * 32;
}

function chirpInput(
  samples,
  real,
  imaginary,
  kernelReal,
  kernelImaginary,
  first,
  last,
) {
  const length = samples.length,
    size = real.length;
  for (let i = first; i < last; i++) {
    const angle = (Math.PI * ((i * i) % (2 * length))) / length;
    const cosine = Math.cos(angle),
      sine = Math.sin(angle);
    real[i] = samples[i] * cosine;
    imaginary[i] = -samples[i] * sine;
    kernelReal[i] = cosine;
    kernelImaginary[i] = sine;
    if (i) {
      kernelReal[size - i] = cosine;
      kernelImaginary[size - i] = sine;
    }
  }
}

function multiplySpectrum(
  real,
  imaginary,
  kernelReal,
  kernelImaginary,
  first,
  last,
) {
  for (let i = first; i < last; i++) {
    const re = real[i] * kernelReal[i] - imaginary[i] * kernelImaginary[i];
    imaginary[i] = real[i] * kernelImaginary[i] + imaginary[i] * kernelReal[i];
    real[i] = re;
  }
}

function chirpOutput(real, imaginary, length, first, last) {
  for (let i = first; i < last; i++) {
    const angle = (Math.PI * ((i * i) % (2 * length))) / length;
    const cosine = Math.cos(angle),
      sine = Math.sin(angle);
    const re = real[i] * cosine + imaginary[i] * sine;
    imaginary[i] = imaginary[i] * cosine - real[i] * sine;
    real[i] = re;
  }
}

// Forward DFT with a negative exponent. Bluestein handles arbitrary selection
// lengths without padding the signal or moving its frequency bins.
/**
 * Preserve exact selection length and negative-exponent phase convention, including prime lengths.
 * Returned views can retain larger convolution buffers.
 * @returns {{real: Float64Array, imaginary: Float64Array}} N complex coefficients, including both
 *   frequency halves.
 */
function* spectrumSteps(samples) {
  const length = samples.length;
  if (!length)
    return { real: new Float64Array(), imaginary: new Float64Array() };
  const { size, radix2 } = transformSize(length);
  const real = new Float64Array(size),
    imaginary = new Float64Array(size);
  if (radix2) {
    real.set(samples);
    yield* fft(real, imaginary);
  } else {
    const kernelReal = new Float64Array(size),
      kernelImaginary = new Float64Array(size);
    for (let first = 0; first < length; first += fftBatch) {
      chirpInput(
        samples,
        real,
        imaginary,
        kernelReal,
        kernelImaginary,
        first,
        Math.min(length, first + fftBatch),
      );
      if (length > fftBatch) yield;
    }
    yield* fft(real, imaginary);
    yield* fft(kernelReal, kernelImaginary);
    for (let first = 0; first < size; first += fftBatch) {
      multiplySpectrum(
        real,
        imaginary,
        kernelReal,
        kernelImaginary,
        first,
        Math.min(size, first + fftBatch),
      );
      if (size > fftBatch) yield;
    }
    yield* fft(real, imaginary, true);
    for (let first = 0; first < length; first += fftBatch) {
      chirpOutput(
        real,
        imaginary,
        length,
        first,
        Math.min(length, first + fftBatch),
      );
      if (length > fftBatch) yield;
    }
  }
  return {
    real: real.subarray(0, length),
    imaginary: imaginary.subarray(0, length),
  };
}

/** Synchronous reference uses exactly the same arithmetic and traversal. */
export function fourierSpectrum(samples) {
  const steps = spectrumSteps(samples);
  let step;
  do step = steps.next();
  while (!step.done);
  return step.value;
}

/** Yield real tasks during large transforms; canceled work never publishes coefficients. */
export async function fourierSpectrumAsync(samples, current = () => true) {
  if (!current()) return null;
  const steps = spectrumSteps(samples);
  try {
    for (;;) {
      const step = steps.next();
      if (step.done) return current() ? step.value : null;
      if (!(await yieldScan(current))) return null;
    }
  } finally {
    steps.return();
  }
}
