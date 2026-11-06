# Lag dependence and periodic structure

Current delivery: Explicit lag equality/difference/mutual information are implemented. Automatic lag search remains a separate extension. See [implemented behavior](../statistical-analyses.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Proposal: compare byte positions separated by a configurable lag. Simple lagged
lookups already work through recipes; aggregate equality and dependence measures
would be new providers. See [lagged coordinate plots](lagged-coordinate-plots.md)
for the inexpensive visualization experiment that can precede them.

## Question and examples

Does knowing the byte at `i-k` tell us something about the byte at `i`? Testing
lags such as 2, 4, 16, 64 and 256 could expose interleaved fields, record widths,
repeated rows, channel ordering, and periodic padding.

An equality score asks whether the bytes repeat exactly. A dependence score can
also identify a regular relationship between different values. For example, the
same field in successive records might count upward rather than remain constant.
These measurements complement a spectrum because byte categories and numeric
byte amplitudes do not express the same relationships.

## Several measurements, with separate meanings

For a comparison window, include only pairs whose two addresses are available:

```text
X = byte[i-k]
Y = byte[i]
equality = number of pairs with X == Y / number of valid pairs
mean absolute difference = mean(abs(Y-X)) / 255
mutual information = sum p(x,y) * log2(p(x,y)/(p(x)*p(y)))
```

The information-measure definition is covered in [MIT's information theory
notes](https://ocw.mit.edu/courses/6-441-information-theory-spring-2016/184197ca5d5418da2415d37e929860b9_MIT6_441S16_chapter_2.pdf).
The proposal is to expose these alternatives explicitly, rather than label every
correlation-like quantity as the same factor.

Equality is easy to explain. Absolute difference imposes a numeric ordering on
byte values. Mutual information measures dependence between byte categories and
can retain a relationship after a consistent relabeling of values. Its empirical
estimate is sensitive to sample count and sparse joint tables; positive results
on short windows are not automatically evidence of an interesting period.

A constant sequence illustrates an important distinction: equality is one,
but mutual information is zero because neither variable has uncertainty. A
normalization such as `I/min(H(X), H(Y))` needs an explicit zero-entropy policy;
do not turn the undefined ratio into a claim of perfect information transfer.
Retain raw bits and a validity/result-status projection.

## Parameters and boundary policy

Start with one positive byte lag and an explicitly sized comparison window.
Specify whether the window is centered at the addressed byte or precedes it,
whether context may extend into the root source, and how many valid pairs are
required. Clip to available data without inserting synthetic zero-byte pairs.
Inspection should report the resulting pair count and both contributing ranges.

A selection-wide result can help explore candidate strides. A moving-window
result reveals where a particular periodicity begins or disappears. They should
be separate scope choices. Changing selection, lag, window, or scope invalidates
the corresponding provider; changing camera or footprint does not.

An optional future search over a set of lags could return the strongest lag,
strength, and the full tested set. Search range, tie handling, and preference
among harmonic/multiple periods must be explicit. A repeating width-16 structure
can also score well at 32 or 48; the largest score alone does not establish a
unique record width.

## Visual experiments

- Fix the lag at a suspected record width and color a normal byte grid by local
  equality or dependence. Changing grid dimensions should not change the lag.
- Map lag to hue and strength to opacity after an explicit best-lag search.
- Compare a first-order transition/surprise view against the same analysis at lag
  16 to distinguish adjacency from field-to-field structure.
- Plot a lagged byte pair while using entropy or DFT amplitude for shading.

Every population can consult the provider through an address relationship. The
meaning for a tuple remains its representative occurrence unless a later
occurrence-reduction recipe is requested. A spectral bin is not inherently a
record position; retain its explicit byte lookup relationship.

## Performance and reuse

Equality and absolute difference can use rolling sums for a fixed lag/window.
A mutual-information model needs joint and marginal counts. A 256×256 table of
32-bit counters costs 256 KiB per independent model, so eagerly retaining one for
every lag and every window center would be expensive.

Start with one requested lag and a rolling or selected-window model. Share
identical provider requests across channels. Sparse sampling may justify computing
only requested neighborhoods; dense scans can update pair counts as windows move.
Correctness requires accounting for both addresses when a range enters or leaves
scope. Use counter widths appropriate to the supported input sizes.

## First increment and validation

Begin with lagged equality, comparison count, and mean absolute difference.
Add mutual information after the scope and inspection model is established.
Validate against direct loops on constant data, alternating values, known
periods, relabeled patterns, noise, windows shorter than the lag, and source/page
boundaries. Compare sparse, rolling, and fresh results where multiple strategies
exist.

A first useful demonstration is a synthetic stream of repeated records with one
field changed: the expected lag should expose the affected field positions while
ordinary adjacent-byte comparisons show a different pattern. Report measured
cost as lag/window/sample counts grow before proposing an automatic lag search.
