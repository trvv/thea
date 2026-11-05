# Distribution-change scores

Proposal: a new local histogram-comparison provider. The aim is to locate changes
in byte composition even when the entropy on each side remains similar.

## Why it adds something to entropy

Two constant regions, one containing `00` and one containing `FF`, both have zero
entropy. Two uniform regions using disjoint groups of 128 byte values both have
seven bits of entropy. A transition between their distributions can therefore be
interesting without a corresponding change in entropy.

Compare a window before an address with a window after it. A high score could
highlight boundaries among padding, text-like regions, tables, numeric payloads,
or other distributions. The score identifies a statistical change, not a file
format or an exact structural boundary.

## Window and score definitions

For a boundary at absolute address `i`, window length `W`, and optional gap `G`:

```text
left  = [i-G-W, i-G)
right = [i+G, i+G+W)
P, Q  = independently normalized byte histograms of those windows
M     = (P + Q) / 2
JS    = (KL(P || M) + KL(Q || M)) / 2
```

Use base-two logarithms and define zero-probability contributions as zero.
The equal-mixture Jensen–Shannon divergence ranges from zero to one bit, making
its raw value convenient for a display channel. Do not confuse it with its square
root, the Jensen–Shannon distance; [SciPy's reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.jensenshannon.html)
explicitly distinguishes the two.

A simpler alternative is total variation: `0.5 * sum(abs(P[b]-Q[b]))`, also bounded
by zero and one. It avoids logarithms and may be a useful first implementation.
The metric belongs in the serialized analysis parameters; changing it must not
silently preserve a misleading factor name or cached result.

## Address and edge semantics

Treat `i` as a candidate boundary: the left window excludes `i`, while the right
window includes it when `G=0`. This prevents an unexplained one-byte overlap.
Source clipping, requested versus actual lengths, and the two half-open ranges
must be inspectable.

Root-source context would be consistent with contextual entropy. A selection-only
mode could be useful, but must be explicit. If clipping leaves either side empty,
return unavailable/validity separately from an ordinary zero score. If the two
remaining windows have different lengths, normalize their histograms separately;
do not accidentally weight the longer side more heavily.

Finite windows spread a sharp transition across a neighborhood. Small windows
provide sharper localization but noisier estimates. Large windows smooth over
small structures, and a gap can skip a header-sized region between the two sides.
Expose these controls rather than promising one precise boundary coordinate.

## Mixing and presentation

The provider should take an address and remain available to all populations.
Tuple first occurrences and explicit bin-to-byte relationships work the same way
as other local analyses. It must not require switching the position preset or
force the source into a special domain.

Examples include:

- Keep a linear or Hilbert coordinate recipe, use change score as lightness, and
  retain byte value or entropy for hue.
- Compare change scores at short and long window lengths to distinguish small
  field boundaries from broader region changes.
- Color a lagged coordinate cloud by distribution change to see whether a new
  region also changes relationships between bytes.

Inspection should expose the two distributions or their counts, sample lengths,
window/gap settings, metric, normalization, raw score, and source ranges. The
existing popup's collapsed sections can hold the distributions without dumping
all 256 entries into every point label.

## Preparation and cost

Two 256-bin histograms are small. Scanning every window independently is not
necessarily cheap: dense requests should consider rolling updates. For fixed,
full-sized windows, moving the boundary one byte changes only the outgoing and
incoming categories on each side. Maintain the affected metric contributions
rather than summing all 256 bins for every address.

At clipped edges, changing normalization denominators can affect every category.
A direct 256-bin recalculation there is a valid correctness-first option. Sparse
requests can instead group neighborhood reads and compute only their windows.
Do not allocate a complete source-length score array merely because a handful
of points consult the provider.

Share identical window/gap/scope requests across display channels. Cache counts
and results independently from projection and raster choices. Cancellation must
not publish a partially updated pair of distributions.

## First increment and acceptance examples

Implement one metric, explicit ranges, validity, and a direct reference algorithm.
Optimize dense cases only after equivalence tests pass. Use constant-to-constant
changes, disjoint equal-entropy alphabets, the same distribution in different
orders, short files, clipping, empty sides, and overlapping page boundaries.

Identical distributions should score zero even if their byte order differs;
lag analysis is the separate tool for that difference. Disjoint distributions
should reach the metric's documented maximum. Cached, sparse and rolling results
must agree, and changing only sample count must not change the underlying score
at an unchanged address.
