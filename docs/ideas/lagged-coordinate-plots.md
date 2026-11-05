# Lagged coordinate plots

Experiment using existing byte lookup, arithmetic and normalization recipes.
This is a configurable coordinate construction, not a new global Layout mode.

## Basic construction

Plot bytes separated by an explicit lag:

```text
X = byte[i]
Y = byte[i + K]
Z = byte[i + 2*K]    // optional third coordinate
```

At `K=1`, this resembles ordinary byte-pair/triple geometry. Increasing `K` can
expose relationships between corresponding positions in records, interleaved
channels, repeated rows, or delayed versions of a byte-valued signal. A pattern
that looks diffuse for adjacent bytes may organize into lines, surfaces or
clusters at another lag.

The geometry is exploratory. It does not calculate statistical significance or
establish a record width. [Lag dependence](lag-dependence.md) proposes complementary
windowed measurements of equality or information shared at a lag.

## A current 3D recipe

This example reads at actual byte offsets and uses currently supported recipe
operations. Changing `lag` regenerates expression data; no new evaluator operation
is implied.

```js
const lag = 16;
const channel = delta => ({
  op: 'normalize', min: 0, max: 255,
  input: {
    op: 'byte',
    offset: {op: 'add', a: {op: 'offset'}, b: {op: 'constant', value: delta}}
  }
});
const expressions = {
  x: channel(0),
  y: channel(lag),
  z: channel(2 * lag),
  valid: {
    op: 'normalize', min: 0, max: 1,
    input: {
      op: 'subtract',
      a: {op: 'subtract', a: {op: 'length'}, b: {op: 'offset'}},
      b: {op: 'constant', value: 2 * lag}
    }
  }
};
view.pointConfiguration = {
  ...view.pointConfiguration,
  space: 'cube', footprint: 'point',
  position: [expressions.x, expressions.y, expressions.z]
};
view.appearance = {...view.effectiveAppearance, opacity: expressions.valid};
```

For two dimensions, select a square or circle and retain only the visible X/Y
mappings. A mask for two dimensions needs only the final required lookup at `i+K`,
not the unused Z lookup. Stored hidden position mappings must remain lazy.

## Population remains a separate choice

The example preserves the current population. With byte points it plots sampled
source starts, retaining repeated occurrences as separate marks. With pair/triple
populations it uses each tuple's first selected occurrence and reads lagged bytes
there. That is not a histogram of distinct lagged pairs/triples.

A dedicated lagged-tuple population could later aggregate distinct delayed tuples,
but that would be a separate, explicitly chosen population. Do not silently
change aggregation just because the coordinates happen to read delayed bytes.
Bin points can also consult these byte lookups, using their existing byte
correspondence rather than pretending the coordinates are intrinsic coefficients.

## Boundary and origin choices

Current byte recipes zero-fill outside the selection. The example opacity mask
hides points whose final requested byte is missing. Without it, the tail may
collapse onto a zero plane, producing a misleading geometric feature. Inspection
should make both the lookups and boundary behavior visible.

The lag is measured in source bytes. It is unrelated to rendered column count,
Hilbert order, camera rotation, or display dimensions. Negative/past-looking and
asymmetric lags can be expressed separately; a later convenience editor should
store those offsets directly.

If record alignment matters, an address expression can start from a chosen base
and advance by a stride. Be clear whether that changes which addresses existing
points read or actually enumerates a new population of record starts. An arithmetic
change to lookup addresses should not quietly modify the selected byte interval.

## Shading that preserves context

A coordinate cloud can lose visible source order. Shade it by source position to
see progression through the file, by entropy to show local distribution, or by
occurrence count to expose repeated values. Conditional surprise could eventually
separate common and unusual delayed relationships.

Try a fixed known lag before a sweep. Lags related by multiples can produce
similar geometry, so an apparent best view is not proof that one lag is uniquely
correct. Keep useful lag choices as reusable recipe definitions or presets,
without bringing back the removed arrangement metaphor.

## Cost and validation

The construction needs three byte lookups and ordinary arithmetic per point.
Shared offset arithmetic and byte reads can use the existing DAG. It adds no FFT
or histogram solely because coordinates form a delayed embedding. The source
provider's current whole-selection buffer remains a separate performance concern.

Use repeated rows, interleaved ramps, counters, alternating patterns and noise.
Check `K=1` against equivalent explicit byte recipes, known record widths against
unrelated lags, clipped tails, two-dimensional hidden Z, and offsets beyond
float32's adjacent-integer range. Camera and raster changes must not alter the
underlying lookups.

An acceptance example should preserve one selected interval and population while
changing only lag, then explain a chosen point's three source addresses through
inspection. That establishes a useful composable coordinate recipe before any
new analysis API is necessary.
