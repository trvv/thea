# Byte differences and local changes

Experiment using existing recipes. No new statistical provider or built-in factor
is required for the examples below.

## What to look for

Compare a byte with a nearby byte to show change instead of absolute value.
Constant runs disappear under magnitude, increments become low steady values,
and abrupt transitions become stronger. A signed view distinguishes upward from
downward changes; an absolute view treats both directions alike.

This can reveal padding boundaries, ramps, repeating field transitions and the
shape of byte-valued signals. It imposes a numeric ordering on bytes. If the
interesting property is which bits change, compare [bit structure](bit-structure.md)
instead: `7F -> 80` is a small numeric change but a large bit change.

## Current recipe example

The following uses supported operations. `read(delta)` is a JavaScript factory
for expression data, not code executed inside the recipe evaluator. It uses the
representative byte offset directly, avoiding an accidental comparison between
an averaged `value` factor and a single predecessor byte.

```js
const read = delta => ({
  op: 'byte',
  offset: {op: 'add', a: {op: 'offset'}, b: {op: 'constant', value: delta}}
});
const difference = {op: 'subtract', a: read(0), b: read(-1)};
const expressions = {
  signed: {op: 'normalize', input: difference, min: -255, max: 255},
  magnitude: {op: 'normalize', input: {op: 'abs', input: difference}, min: 0, max: 255},
  valid: {op: 'normalize', input: {op: 'offset'}, min: 0, max: 1}
};
view.appearance = {
  ...view.effectiveAppearance,
  hue: expressions.signed,
  lightness: expressions.magnitude,
  opacity: expressions.valid
};
```

The signed mapping places no change at 0.5, the largest downward change at zero,
and the largest upward change at one. Magnitude maps no change to zero. Appearance
conventions still apply: mapped hue spans 0–300 degrees and colored lightness
retains headroom, so a zero factor is not necessarily a black final pixel.

Raw subtraction can be negative and must be normalized before it becomes a
terminal display result. Intermediate arithmetic inside a recipe is not clamped
at every operator; display outputs are clamped after evaluation. Saved factor
references expand into the containing graph and can share this arithmetic.

## Boundaries and sampling

Ordinary `byte` lookups are selection-bounded. At the first selected byte,
`read(-1)` returns zero, which could create an artificial jump. The example's
validity-like opacity expression masks that first address. It is an ordinary
numeric recipe, not a new source-validity API.

For a past lag `K`, compare `read(0)` with `read(-K)` and use a mask that becomes
one once the offset reaches `K`. If a future contextual provider reads outside
the selection, it should expose that scope explicitly rather than silently
change these existing lookup semantics.

Downsampling chooses representative addresses for these explicit byte reads.
The difference between two averaged intervals, the average of absolute per-byte
differences, and the difference at one representative address are not equivalent.
The current example deliberately chooses the last interpretation. Small isolated
changes can disappear if no sampled address reaches them; a reduction over the
whole sample interval would be a separate analysis.

## Useful variations

- Change the comparison lag to a suspected record width and shade a source-position
  view. This compares corresponding byte positions rather than adjacent fields.
- Use second differences, such as `b[i] - 2*b[i-1] + b[i-2]`, to emphasize changes
  in an incrementing sequence. Adjust signed normalization bounds accordingly.
- Plot byte value against change magnitude, with entropy or occurrence counts as
  another independent channel.
- Compare the result with [distribution change](distribution-change.md), which
  describes neighborhoods rather than an individual pair.

A byte wrapping from 255 to zero creates a large signed difference even if it is
an intentional counter increment. Modular differences could be another explicit
recipe/policy; do not reinterpret all differences as wrapped automatically.

## Cost, inspection and first experiment

Each point needs a few lookups and arithmetic operations. Identical reads can be
shared by the existing recipe DAG. There is no histogram or FFT preparation,
although the current provider still reads a selected byte buffer; future sparse
paging could reduce that source cost without changing the expression.

The point popup already shows both resolved byte addresses, raw values, subtraction,
normalization and trait result. This is a good early experiment precisely because
its output can be explained using existing inspection.

Use constant runs, ascending/descending ramps, wraparound counters, isolated
jumps and repeated records. Check endpoints, the masked first address, negative
intermediates, large index arithmetic and representative sampling. The useful
completion result is a reusable named recipe or a small preset example; adding
a new built-in source should require a benefit beyond shortening a few operators.
