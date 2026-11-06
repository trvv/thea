# Repetition and localized spectra

These implemented providers use ordinary `analysis` expressions. Their scopes,
address relationships, parameters and validity are independent of position
presets and point population. See the [recipe reference](recipes.md) for the
shared expression and menu contracts.

## Exact previous blocks

```js
const match = {
  op: "analysis",
  family: "repetition",
  kind: "distance",
  offset: { op: "offset" },
  scope: "selection",
  history: 65536,
  overlap: true,
  maxLength: 4,
};
view.appearance = {
  ...view.effectiveAppearance,
  hue: { op: "normalize", input: match, min: 0, max: 65536 },
  opacity: { ...match, kind: "valid" },
};
```

At the addressed byte, find the nearest previous start with the same complete
four bytes. Keys pack those four bytes exactly into a Number; no probabilistic
hash match is reported as exact. `history` is the maximum distance, from one to
one million bytes. The start must be inside the selected interval. The current
start is never inserted before querying it, so it cannot match itself.

`overlap: true` permits overlapping source blocks. With overlap off, eligibility
is delayed until a previous four-byte block ends before the current start; the
algorithm does not reject only the newest overlapping candidate and overlook an
older eligible one. `maxLength` from four to 4096 extends the chosen nearest
candidate while bytes continue matching. Nonoverlapping extensions stop at the
candidate distance. This is the chosen candidate's match length, not the global
longest match among all previous starts.

Projections are raw `distance`, raw `length`, and `valid`. Missing prior matches
and incomplete trailing four-byte blocks have validity zero; their scalar distance
and length are zero. A genuine prior match always has positive distance. Inspection
includes exact absolute spans, compared bytes, search-start range, history,
overlap policy and the chosen-candidate policy. Display normalization is separate.

Preparation scans the needed prefix from the first requested position's history
start through the last requested position. A most-recent-key Map expires entries
without deleting newer occurrences of that key. Only requested results are
retained; there is no selection-length result array. History, requested results
and extension work are budgeted, and long scans/extensions yield for cancellation.
A budget failure rejects exact work rather than silently shortening history.

## Local band energy

```js
const energy = {
  op: "analysis",
  family: "spectral",
  kind: "energy",
  offset: { op: "offset" },
  scope: "selection",
  window: 256,
  hop: 128,
  origin: 0,
  taper: "hann",
  preprocessing: "mean",
  edge: "omit",
  low: 0.02,
  high: 0.08,
  dc: false,
};
view.appearance = {
  ...view.effectiveAppearance,
  lightness: energy,
  opacity: { ...energy, kind: "valid" },
};
```

Frames begin at `origin + m*hop`, relative to the selected interval. An address
chooses the latest frame start not after it, using `floor((offset-origin)/hop)`.
It does not choose a frame from rendered row width or a bin ordinal. Byte and
tuple marks use their actual addressed occurrence; global frequency-bin marks
still need their normal byte correspondence to consult a local frame.

`window` is one to 4096 samples (default 256); `hop` is one to one million
(default half the frame length, floored and at least one), and `origin` is zero
to one million (default zero). Tapers are `rectangular` (default, weight one)
or `hann`, specifically periodic Hann `0.5 - 0.5*cos(2*pi*n/N)`.
Preprocessing is `unsigned`, `centered` (subtract 127.5), or `mean` (default,
subtract the available frame samples' mean).

`edge: "omit"` (default) makes incomplete frames invalid. `edge: "zero"` keeps
the requested transform length and zero-pads unavailable samples after
preprocessing. The latter does not shrink a frame or count padded zeros as real
observations. Actual contributing spans/counts and requested frame bounds remain
separate in inspection. A hop longer than the frame can select a frame that does
not contain the addressed byte; that is the explicit latest-start relationship.

Frequency bands use cycles per byte in `[0, 0.5]`, with both endpoints included.
`low` and `high` default to zero and 0.5; equal bounds select a bin only when its
frequency matches. `dc: false` (default) excludes DC from both numerator and
denominator. The provider computes a negative-exponent DFT of exactly the frame
length. One-sided power weights are one at DC and the even-length Nyquist bin,
two at interior bins. Coefficient power below the frame peak coefficient power
times `1e-20` is suppressed as numerical noise, matching the global amplitude's
`1e-10` magnitude convention. This prevents residual transform error from
presenting a constant DC-only signal as valid non-DC energy.

`energy` is band power divided by total retained power. A zero denominator is
invalid and returns zero; it is not evidence of confidently absent band content.
`valid`, raw `power` (band power), and raw `totalPower` are additional projections.
The raw powers have no claimed physical units or amplitude normalization. A
finite band with no included bins yields zero energy when total power is valid.

Preparation collects actual requested addresses and deduplicates their frames
before normal evaluation. The synchronous render visitor only looks up prepared
reductions; it does not run an FFT for each mark. Cached data retains reductions,
not a whole frame-by-frequency matrix. Temporary FFT/storage estimates and
result Maps count toward the provider budget. Cancellation never publishes an
incomplete batch. On-demand inspection recomputes one bounded frame to expose
samples, coefficients, band bins, endpoint conventions and raw sums.

Root-source-aligned frames, alternative interpolation across local frames,
spectrogram populations and a GPU transform backend remain distinct extensions.

## Global spectrum interpolation

An ordinary `spectrum` expression accepts `interpolation: "nearest"` (the
default legacy bucket lookup) or `"complex"`. Legacy behavior remains
`floor(clamp(input)*binCount)`, capped at the last bin. Complex mode instead spans
continuous coefficient coordinates `clamp(input)*(binCount-1)`, interpolates real
and imaginary coefficients, and derives phase from their blend. It never averages
wrapped phase angles. An exactly zero blended coefficient has normalized phase
0.5, consistent with the existing zero-coefficient convention.

Amplitude uses the blended coefficient magnitude and a linearly interpolated
one-sided endpoint multiplier (one at DC/Nyquist, two inside). It retains the
global peak's `log1p` normalization and small-amplitude suppression. The combination
can exceed endpoint-normalized amplitude in some cases; terminal display clamping
still applies, while inspection preserves the uncapped calculation. This is an
explicit coefficient interpolation, not a fresh DFT at a fractional frequency.
Frequency mode returns the same continuous bin coordinate in cycles/Nyquist units
without needing coefficients or an FFT. Inspection identifies both contributing
bins, fraction, raw coefficients and blended weight.

## Validation

`tests/repetition.js` compares all requested results with direct nearest-match
searches, including expiration, overlap and extension. `tests/local-spectrum.js`
compares coefficients to direct DFT sums and powers to Parseval's relation, with
odd/even frames, tapers, preprocessing, DC, padding, budgets and deduplication.
`tests/spectrum-sampling.js` covers legacy parity, phase wrapping, endpoint weights,
continuous frequency and actual provider integration. Generated complex sampling
GLSL is executed by the shader suite; WGSL retains structural-only validation.
