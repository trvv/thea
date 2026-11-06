# Statistical recipe analyses

Statistical expressions use the ordinary recipe, point population and inspection
pipeline. A tuple addresses its selected representative occurrence; a bin uses
its explicit byte correspondence. These analyses do not select a separate
renderer or prevent mixing byte, entropy, spectrum and numeric factors.

```js
const surprise = {
  op: "analysis",
  family: "conditional",
  kind: "surprise",
  scope: "selection",
  alpha: 1 / 256,
  offset: { op: "offset" },
};
view.appearance = {
  ...view.effectiveAppearance,
  hue: { op: "normalize", input: surprise, min: 0, max: 16 },
};
```

Offsets are selection-relative actual byte addresses, floored for lookup.
Out-of-selection addresses return zero and have validity zero. `scope` is
serialized and currently supports `selection`; root-context scopes are rejected
rather than silently reinterpreted. This differs from the existing entropy
provider's root-source neighborhood. All new parameters survive normal preset
save/load and worker cloning.

## Conditional transitions

`family: "conditional"` fits one first-order transition table to all valid
adjacent byte pairs in the selected interval. Output `kind` is `probability`,
`surprise`, or `valid`. Positive additive smoothing `alpha` defaults to `1/256`
and must be finite and at most 1,000,000.

```text
P(current | previous) = (transitionCount + alpha) / (previousRowCount + 256*alpha)
surprise = -log2(P)
```

The first selected byte lacks a predecessor and is unavailable. The model is
descriptive: it includes the scored transition in its training scope. Sampling
does not redefine its exact counts. Raw surprise may exceed eight bits and must
be normalized explicitly before a display channel; the example uses fixed
0–16-bit bounds. This does not silently cap the inspected raw score.

Inspection shows both byte addresses/values, training range/policy, smoothing,
row and transition counts, probability and uncapped bits. It does not claim
encryption or file-type identification.

## Lag equality and dependence

`family: "lag"` compares `X = byte[j-lag]` with `Y = byte[j]`. Positive integer
`lag` defaults to one and is bounded by 1,000,000. `window` defaults to 32 and is
an integer in 0–4096. Zero requests a single aggregate over the entire selected
interval. Positive windows select centered Y addresses around the queried byte,
clipped to the selection; only pairs with both real bytes available contribute.
The corresponding X range is shifted left by `lag`.

| Kind          | Raw output                                            |
| ------------- | ----------------------------------------------------- |
| `equality`    | Equal pairs divided by valid pair count.              |
| `difference`  | Mean absolute numeric byte difference divided by 255. |
| `information` | Empirical mutual information in bits.                 |
| `pairs`       | Valid pair count.                                     |
| `valid`       | One when at least one pair exists, zero otherwise.    |

Mutual information uses exact joint and marginal counts with base-two logs.
A constant stream has equality one and information zero. No hidden division by
entropy produces an undefined normalized claim. Divide information by an explicit
eight-bit range for display when desired. The raw count remains exact in
inspection; ordinary scalar arithmetic and terminal display values retain their
existing Float32 precision contract. Short-window empirical information can be
biased upward and is not statistical significance or an automatic stride search.

## Distribution change

`family: "distribution"` compares two separately normalized byte histograms:

```text
left  = [address-gap-window, address-gap)
right = [address+gap, address+gap+window)
```

Both ranges clip to the selected interval. `window` defaults to 32 and must be
1–4096; `gap` defaults to zero and must be an integer in 0–1,000,000. Kind
`variation` returns total variation, `0.5 * sum(abs(P-Q))`. Kind `divergence`
returns equal-mixture Jensen–Shannon divergence in bits, not its square-root
distance. Both range from zero to one. `valid` requires at least one byte on each
side; missing sides do not become confident zero-change measurements.

The boundary byte belongs to the right side when gap is zero. Unequal clipped
window lengths normalize independently. Inspection shows actual ranges, sample
counts, distributions and both metrics. Different constant alphabets reach one
despite having equal entropy; identical distributions in another order score
zero.

## Bit bias and entropy

`family: "bit"` measures a centered selected window. `bit` is numbered from zero
at the least significant bit through seven. `window` defaults to 32 and must be
1–4096. All eight set-bit counters share one prepared window model.

| Kind      | Raw output                                  |
| --------- | ------------------------------------------- |
| `bias`    | Fraction with the requested bit set.        |
| `entropy` | Binary entropy in bits, from zero to one.   |
| `count`   | Number with the requested bit set.          |
| `valid`   | One when the clipped window contains input. |

Constant-zero and constant-one bits have biases zero and one, while both have
zero entropy. Missing bytes do not contribute synthetic zero bits. Inspection
shows the exact source range, sample count, ones/zeroes, bias and entropy.

## Raw occurrences and exposure

`family: "occurrence"` counts all complete selected byte tuples of `width` one,
two or three. Kinds are raw `count`, `probability`, mapped `exposure`, and `valid`.
Probability divides by the exact number of valid tuple starts. Incomplete tail
tuples are unavailable. The width and lookup address do not change the point
population or sample limit.

Exposure uses explicit parameters:

```text
log1p(compression * count) / log1p(compression * referenceCount) * exposure
```

`compression` and `exposure` default to one, are finite and positive, and are
bounded by 1,000,000. Reference policy is `"percentile"` by default, with
`percentile: 0.99`, or `"fixed"` with positive `referenceValue` defaulting to one.
A percentile is a nearest-rank order statistic of exact selected count values:
rank `max(0, ceil(percentile * populationSize)-1)` after ascending sort. Values
zero and one select the minimum and maximum. `includeZero: false` excludes
absent categories; true includes the full alphabet of 256, 65,536 or 16,777,216
possible tuples. Triple zeroes remain implicit and never allocate a full table.

The reference distribution is independent of rendered sampling. Raw counts and
normalization are calculated before scalar Float32 conversion. Exposure can
exceed one before the ordinary display clamp; raw counts, reference policy and
unclamped exposure remain inspectable. A zero reference produces exposure zero
and `referenceValid: false` in inspection rather than a divide-by-zero artifact.
The `valid` projection still describes whether the addressed tuple exists.

Different projections and reference/exposure choices share raw models of the
same width. This is selection-space frequency, not screen-space density: camera,
footprint and overlapping marks do not alter the count. Optional accumulation
rendering has a separate contributor/coverage contract in the
[density proposal](ideas/cantordust-density-mapping.md).

`tests/occurrence-analysis.js` covers all widths, exact direct counts, nearest-rank
references, absent alphabets, count precision above Float32's adjacent-integer
range, normalization before conversion, shared models, sampling independence,
source scope, budgets and cancellation.

## Preparation, memory and validation

Only reachable analysis nodes prepare data. Current statistical providers use
the dense selected byte buffer; they deliberately opt out of sparse byte/entropy
execution until their own scan strategies are extended. They collect actual
queried addresses in preparation, including bounded additional passes when an
address depends on another analysis. Sorted requests use rolling counts. Normal
point evaluation then performs scalar lookups rather than rebuilding histograms
or transition models per rendered mark.

Conditional models share their raw table across projections and smoothing
choices. Local bit projections share eight counters; lag projections share a
joint model. Local result Maps contain requested centers rather than a complete
source-length result array. Global lag window zero retains one aggregate.
Models, result storage and temporary joint tables have provider-budget checks;
long scans/preparation batches yield for cancellation, and partial new models are
not published. Exact typed-buffer accounting excludes JavaScript Map/array object
overhead; budget estimates account for it conservatively.

`tests/analysis-providers.js` compares every output against direct loops on
deterministic fixtures, covering clipped windows, absent pairs/sides, zero
entropy, disjoint distributions, raw scores above display limits, shared
projections, nested addresses, model reuse, laziness, budgets and cancellation.
`tests/analysis-recipes.js` covers schema/type/menu/profile/emitter contracts.
