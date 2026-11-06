/** Explicit relationships to one-sided global coefficients, preserving legacy bucket sampling. */
const clamp = (value) => Math.max(0, Math.min(1, value));
const weight = (bin, length) => (bin === 0 || bin * 2 === length ? 1 : 2);
const phase = (real, imaginary) => {
  const magnitude = Math.hypot(real, imaginary);
  return Math.abs(imaginary) < magnitude * 1e-12
    ? real >= 0
      ? 0
      : Math.PI
    : Math.atan2(imaginary, real);
};

export function spectrumSamplePosition(
  position,
  length,
  interpolation = "nearest",
) {
  const bins = length ? Math.floor(length / 2) + 1 : 0;
  if (!bins || Number.isNaN(position)) return null;
  const coordinate =
    interpolation === "complex"
      ? clamp(position) * (bins - 1)
      : Math.min(bins - 1, Math.floor(clamp(position) * bins));
  const lower = Math.floor(coordinate),
    upper = Math.min(bins - 1, lower + 1);
  return {
    bins,
    coordinate,
    lower,
    upper: interpolation === "complex" ? upper : lower,
    fraction: interpolation === "complex" ? coordinate - lower : 0,
  };
}

/** Scalar render path uses no coefficient/result objects; complex phase never blends wrapped angles. */
export function sampleSpectrum(
  spectrum,
  length,
  kind,
  position,
  interpolation = "nearest",
) {
  const bins = length ? Math.floor(length / 2) + 1 : 0;
  if (!bins) return 0;
  if (interpolation !== "complex") {
    const bin = Math.min(bins - 1, Math.floor(clamp(position) * bins));
    return kind === "frequency"
      ? (2 * bin) / length
      : kind === "phase"
        ? spectrum.phases[bin]
        : spectrum.amplitudes[bin];
  }
  const coordinate = clamp(position) * (bins - 1);
  if (kind === "frequency") return (2 * coordinate) / length;
  if (Number.isNaN(coordinate)) return NaN;
  const lower = Math.floor(coordinate),
    upper = Math.min(bins - 1, lower + 1),
    fraction = coordinate - lower;
  const real =
    spectrum.real[lower] +
    (spectrum.real[upper] - spectrum.real[lower]) * fraction;
  const imaginary =
    spectrum.imaginary[lower] +
    (spectrum.imaginary[upper] - spectrum.imaginary[lower]) * fraction;
  if (kind === "phase")
    return (phase(real, imaginary) + Math.PI) / (2 * Math.PI);
  const multiplier =
    weight(lower, length) +
    (weight(upper, length) - weight(lower, length)) * fraction;
  const amplitude = (Math.hypot(real, imaginary) * multiplier) / length;
  const peak = spectrum.peakAmplitude;
  return !peak || amplitude < peak * 1e-10
    ? 0
    : Math.log1p(amplitude) / Math.log1p(peak);
}

/** On-demand trace includes both source coefficients and the arithmetic used to combine them. */
export function describeSpectrumSample(
  spectrum,
  length,
  kind,
  position,
  interpolation = "nearest",
) {
  const sample = spectrumSamplePosition(position, length, interpolation);
  if (!sample) return { interpolation, position, valid: false, length };
  const { lower, upper, fraction, coordinate, bins } = sample;
  const result = {
    interpolation,
    position,
    valid: true,
    length,
    binCount: bins,
    binPosition: coordinate,
    lowerBin: lower,
    upperBin: upper,
    fraction,
    cyclesPerByte: coordinate / length,
    nyquistFraction: (2 * coordinate) / length,
  };
  if (kind === "frequency" || !spectrum) return result;
  const real =
    spectrum.real[lower] +
    (spectrum.real[upper] - spectrum.real[lower]) * fraction;
  const imaginary =
    spectrum.imaginary[lower] +
    (spectrum.imaginary[upper] - spectrum.imaginary[lower]) * fraction;
  const oneSidedMultiplier =
    weight(lower, length) +
    (weight(upper, length) - weight(lower, length)) * fraction;
  return {
    ...result,
    lowerCoefficient: {
      real: spectrum.real[lower],
      imaginary: spectrum.imaginary[lower],
    },
    upperCoefficient: {
      real: spectrum.real[upper],
      imaginary: spectrum.imaginary[upper],
    },
    real,
    imaginary,
    oneSidedMultiplier,
    phaseRadians: phase(real, imaginary),
    amplitude: (Math.hypot(real, imaginary) * oneSidedMultiplier) / length,
    normalizedPhase: (phase(real, imaginary) + Math.PI) / (2 * Math.PI),
    ...(kind === "amplitude"
      ? {
          peakAmplitude: spectrum.peakAmplitude,
          normalizedAmplitude: sampleSpectrum(
            spectrum,
            length,
            kind,
            position,
            interpolation,
          ),
          amplitudeNormalization:
            "log1p(amplitude)/log1p(global peak); suppress below peak*1e-10",
        }
      : {}),
  };
}
