# Entropy contrast across scales

Experiment using existing configurable entropy lookups and arithmetic. Comparing
several neighborhood sizes requires no new provider family, but the meaning of
the normalization needs care.

## Question and expected patterns

Is a small neighborhood more or less varied than its surrounding region? A short
constant run inside a varied region can have low short-window entropy and higher
long-window entropy. A small varied island in otherwise repetitive data may show
the reverse relationship.

This emphasizes context rather than just absolute entropy. It can help expose
local islands, short fields, repeated runs, and transitions that a single window
smooths over. It does not by itself compare full distributions; two different
constant values both have zero entropy. Use [distribution change](distribution-change.md)
when composition matters despite equal entropy.

## Compare like units

The current provider returns normalized entropy:

```text
e(W) = H(W) / min(8, log2(W))
```

For `W=1`, the provider returns zero. At actual file edges, the requested window's
maximum remains the normalization denominator even when fewer bytes are available.
The 32-byte lookup retains its existing 8-bit quantization.

Subtracting two normalized values therefore compares fractions of different
achievable maxima. That may be a useful experiment, but it is not an entropy
comparison in bits. For a bit-based comparison, recover each provider's scale
before subtracting:

```text
Hsmall = e(Wsmall) * min(8, log2(Wsmall))
Hlarge = e(Wlarge) * min(8, log2(Wlarge))
contrast = Hsmall - Hlarge
```

The recovered value retains provider rounding/quantization; it is not a new
higher-precision entropy calculation. Comparing windows with different sample
counts also changes estimator behavior. Converting units does not remove
finite-sample effects or establish that a nonzero contrast is anomalous.

## Current recipe example

The factories below create supported expression data. Raw bit-valued
intermediates remain inside the containing expression, before terminal clamping.

```js
const entropyBits = window => ({
  op: 'multiply',
  a: {op: 'entropy', offset: {op: 'offset'}, window},
  b: {op: 'constant', value: Math.min(8, Math.log2(window))}
});
const difference = {op: 'subtract', a: entropyBits(32), b: entropyBits(256)};
const expressions = {
  small: {op: 'divide', a: entropyBits(32), b: {op: 'constant', value: 8}},
  large: {op: 'divide', a: entropyBits(256), b: {op: 'constant', value: 8}},
  contrast: {op: 'normalize', input: difference, min: -8, max: 8},
  magnitude: {op: 'normalize', input: {op: 'abs', input: difference}, min: 0, max: 8}
};
view.appearance = {
  ...view.effectiveAppearance,
  hue: expressions.contrast,
  lightness: expressions.large
};
```

The signed contrast maps zero to 0.5. Positive values mean more entropy in the
shorter neighborhood in bit units; negative values mean less. Using a fixed
`[-8,8]` display range keeps the same difference stable across frames. A user can
choose narrower display bounds to emphasize smaller contrasts.

The `small` and `large` projections share a common eight-bit display scale.
For a fully varied 32-byte neighborhood, `small` is at most `5/8`, rather than
one. This is intentional. If relative achievable diversity is the desired
question instead, use the original normalized lookups and label that choice.

## Addresses, sampling and mixed providers

Both windows should use the same addressed byte unless an expression explicitly
chooses different centers. Entropy reads root-source context beyond the selection
where available, so moving a selection boundary does not necessarily change the
neighborhood at a fixed absolute address. File-edge clipping still matters and
can create a baseline contrast; inspection must show both exact ranges.

Explicit entropy recipes look up the addressed neighborhood. They do not
implicitly average entropy across every byte represented by a downsampled mark.
That differs from the built-in averaged byte-population entropy factor. A later
reduction across a sample interval should be requested explicitly.

Tuple populations use their representative address for the current recipe. Bin
populations use a byte correspondence unless another address expression is
provided. Local entropy does not become a frequency-domain statistic merely
because the point population is bins.

## Presentation, cost and inspection

Try the contrast on existing source-position coordinates before changing space.
Alternatively, plot small entropy against large entropy and shade by source
position. A third coordinate could use a lagged byte value or another independent
factor. This separates a change in measurement from a change in arrangement.

The current provider deduplicates requested entropy windows across a graph. Two
window sizes mean two result preparations, not a new calculation per display
channel. Dense rolling entropy remains linear in source-window length for each
requested size, but current cached arrays still scale with that length. Sparse
provider work remains a separate future improvement.

The existing inspection tree can show both entropy calls, their sizes, source
halos, quantization, scale multiplication, subtraction and final normalization.
That should be sufficient for a first experiment without an extra summary-only
source that conceals how the contrast was built.

## Acceptance examples

Check constant data, repeating complete-byte ramps, short constant islands and
short varied islands. At a fully supported interior center of a complete repeating
`00..FF` ramp, 32 distinct bytes yield five bits and a 256-byte window yields eight:
the bit contrast is minus three, even though both normalized provider outputs can
reach one. This is a useful guard against mixing the two interpretations.

Also test identical window sizes, `W=1`, file-edge clipping, the legacy 32-byte
quantization, negative intermediate differences, and changed sampling/camera
settings. A useful outcome is a reusable named recipe plus an example whose
inspection explains the contrast; a new built-in factor is not required.
