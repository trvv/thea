# Localized spectral energy

Proposal: analyze spectra around explicit byte addresses. The current spectrum
provider transforms the selected interval as a whole; sampling one of its bins
at an address does not make that coefficient a local statistic.

## What a local analysis adds

A global spectrum can show that a periodic pattern exists while obscuring where
it occurs. A sequence of windowed transforms could show a periodic field starting,
a record width changing, a short burst, or different rhythms in adjacent regions.

The first goal could be a few local band-energy scalars, not a complete
spectrogram UI. Low/mid/high-band ratios, a selected frequency's energy, or a
spectral centroid can shade existing byte or Hilbert coordinates. A tuple point
could consult the local spectrum at its representative occurrence and still use
occurrence count for opacity.

## Frame definition

A short-time Fourier transform applies a window to successive signal frames and
advances them by a hop. Window, hop, frequency coordinates and scaling are
independent choices; [SciPy's ShortTimeFFT reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.ShortTimeFFT.html)
provides a concrete description of these relationships. It is a mathematical
reference, not a proposed project dependency.

For Thea, define frame starts as `origin + m*hop`. Initially, a byte address could
select the latest frame start not after that address. Its value is then piecewise
constant over a hop. Nearest-center selection and interpolation are possible
later policies, but should not silently replace that rule.

Specify:

- Window length and coefficient convention, such as a particular Hann definition.
- Hop and its absolute or selection-relative origin.
- Whether bytes are treated as unsigned amplitudes, centered amplitudes, or
  frame-mean-detrended samples.
- Source scope, edge padding/clipping and minimum valid frame length.
- Frequency/band units and power normalization.

These parameters belong to the analysis. Display grid, footprint, sample budget
and camera changes must not alter the signal or choose another window length.

## A focused first output

For each real-input frame, compute complex coefficients `X[k]`. A possible
relative band-energy definition is:

```text
P[k] = endpointWeight[k] * abs(X[k])^2
bandEnergy = sum(P[k] within band) / sum(P[k] over retained frequencies)
```

Use endpoint weight one at DC and at Nyquist when that endpoint exists, and two
for the interior one-sided coefficients. Explicitly choose whether DC participates
in either sum. A zero denominator needs validity or a documented zero-energy
result rather than a fabricated confident ratio.

Define bands using cycles per byte in `[0, 0.5]`, with exact endpoint-inclusion
rules. Do not use hertz without an actual sample-rate interpretation. A transform
of length `N` associates bin `k` with `k/N` cycles per byte. If zero-padding is
introduced, distinguish the changed bin spacing from additional information about
the original frame; it does not lengthen the observed signal.

A relative ratio avoids pretending that arbitrary byte amplitudes have physical
power units. Absolute power, log power, phase and centroid can be added once their
window/scaling conventions are specified. Raw complex or power interpolation
also differs from interpolating wrapped phase values.

## Edges and population relationships

Root-source frames can remain stable when the selected view moves. A
selection-bounded alternative may be useful for isolated-region analysis.
Zero-padding, partial-window clipping and omission produce different spectra;
choose and expose one policy instead of treating them as interchangeable
performance fallbacks.

Byte and tuple populations have existing address relationships. Global bin points
have actual spectral frequencies, but need an explicit byte address when they
consult a local frame. A global bin ordinal should not be silently reused as a
local bin ordinal when transform lengths differ. Express a desired frequency or
band and show the local bin selection in inspection.

A dedicated time/frequency population could later enumerate frames and bins for
a spectrogram. It is independent of the factor provider and should not be
required just to color ordinary points by local energy.

## Cost and caching

Computing a new FFT per rendered point is an expensive default. Reuse frames
selected by multiple points and channels. Cache by source, exact frame range,
window, preprocessing and transform policy; band reductions can share those
coefficients. Reuse the existing FFT implementation where appropriate, not the
global spectrum's incompatible cache identity.

For long selections, prepare only requested frames or maintain a bounded frame
cache. If only band ratios are needed, retain reductions rather than a full
source-length matrix of complex coefficients. Inspection can recompute one frame
when detailed coefficients were deliberately not retained. Never shorten the
analysis window implicitly to meet a rendering budget.

## First increment and validation

Start with one explicit frame convention, one band-energy output, validity and
inspection. Report frame range, hop/origin, selected frame, window/preprocessing,
actual contributing samples, chosen frequency bins, raw power sums, normalization
and clipping/padding.

Validate constant input with DC included/excluded, known byte-valued periodic
signals, frequency changes halfway through a source, short frames, odd/even
lengths and edge policies. Compare frame coefficients to independent direct DFT
sums on small fixtures. Verify that identical addresses keep their values across
camera/raster/sample changes and that frame reuse actually reduces FFT work.
