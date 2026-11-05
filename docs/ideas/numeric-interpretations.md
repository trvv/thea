# Numeric interpretations of byte spans

Proposal: parameterized integer/float reads and useful projections of their raw
representation. This is a lookup interpretation, not a record parser or an
assertion that the source contains those numeric types.

## Questions this could answer

A byte-level view can obscure a smooth sequence stored as 16-bit integers or
32-bit floating-point values. Explicit reads could reveal counters, coordinates,
sample-like sequences, lengths, repeated bounds, and fields whose values become
coherent under one byte order or stride.

Keep multiple interpretations available simultaneously. One axis could read a
little-endian integer while hue describes local entropy; another recipe could
compare the same bytes as a float. A plausible result is worth displaying even
when the surrounding binary has no established schema.

## First supported reads

A focused initial provider could support unsigned/signed 16- and 32-bit integers
and 32-bit floats, with explicit byte order. JavaScript's native `DataView` offers
these reads with a byte-offset and endian argument; its behavior is specified in
[ECMAScript's structured-data section](https://tc39.es/ecma262/multipage/structured-data.html).
Avoid a custom wrapper that only renames those primitives.

Conceptual parameters, not current recipe syntax:

```text
readNumber(address, type, byteOrder)
```

The address expression controls stride and alignment separately. For example,
`base + pointIndex * 12 + 4` could read the middle field of a 12-byte record, while
reading at every byte allows exploration of all alignments. Restricting reads to
aligned addresses should be a configurable analysis policy, not an accidental
consequence of the active grid dimensions.

Useful result projections include value, validity, sign, raw exponent/fraction
fields for floats, and finite/NaN/infinity/negative-zero classification. A local
fraction of finite floats might also be explored, but finite results alone are a
weak plausibility measure and should not hide other candidates.

## Range and precision contracts

The current recipe pipeline distinguishes exact integer indices from float32
visual arithmetic, and clamps terminal display outputs to 0–1. A new read cannot
simply put arbitrary decoded numbers into the existing normalized byte slot.

For integers, preserve the exact raw value through address-safe/integer operations
where the IR supports it, then normalize explicitly for display. Useful mappings
include a fixed type range, chosen physical bounds, sign/magnitude projections,
or a documented local scale. A frame-peak scale would make the same number change
appearance as other points appear, so it should not be the hidden default.

For floats, preserve classification and source bits in inspection. Nonfinite
values must not be presented as genuine numeric zero merely because the renderer's
finite-output guard supplies zero. A validity/classification projection lets a
recipe choose opacity or another visual response.

Float64 and 64-bit integers should follow later. JavaScript Number can represent
a decoded float64, but the current visual IR rounds intermediate scalars to
float32; arbitrary integer64 values also need more than Number's exact-integer
range. Decide how raw reads and normalization interact before claiming faithful
support. Do not introduce a broad new type system just to make the first uint16
example work.

## Scope and partial values

Use explicit half-open byte spans and identify which byte address a point reads.
A selection-bounded initial read could require the complete word inside the
selection. Root-context reads are also useful, but must be a separately serialized
policy. A trailing partial word should be unavailable, not silently assembled
from zero-filled bytes.

An averaged byte sample does not represent a numeric word. Reads should use an
actual address, with later per-word averaging introduced as an explicit reduction.
Tuple points use their representative occurrence unless the expression specifies
another address. Bin points likewise need a byte correspondence; do not describe
a decoded word as the meaning of a spectral coefficient.

## Visual examples

- Plot consecutive decoded values as a lagged trajectory while shading by byte
  entropy, potentially revealing smooth motion hidden in byte order.
- Use float exponent as hue and finite/classification as opacity to explore
  repeated numeric fields without choosing physical value bounds immediately.
- Compare little- and big-endian interpretations in separate channels.
- Read a configurable word at a record stride and plot it against another field.

These are recipes over the same populations and providers. A later record
population could enumerate word/record starts more directly, but it is not a
prerequisite for a useful read operation.

## Preparation, inspection and validation

Group overlapping reads into source pages and reuse byte buffers across types
and channels. No FFT or histogram is needed for direct reads. Statistics over
many decoded words require their own explicit window/provider; do not slip a
whole-selection scan into a scalar lookup.

Inspection should show the exact byte span and hex bytes, type, width, byte order,
alignment/origin, raw value or classification, and normalization used for the
trait. Preserve enough information to distinguish positive and negative zero
and to examine a NaN's source representation.

Validate known encodings of integer endpoints, signed values, ordinary/subnormal
floats, infinities, NaNs, both zeros, both byte orders and unaligned reads. Include
page/selection boundaries, short words, large exact integer offsets and raw values
that would lose precision if converted too early.

A first acceptance fixture can contain interleaved uint16 counters and float32
coordinates. Correct type/stride/byte order should reveal the intended sequences,
while alternate interpretations remain available rather than being filtered out.
