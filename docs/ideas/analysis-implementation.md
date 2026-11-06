# Implementing the analysis ideas

Historical planning baseline: implementation has since advanced. Consult the [PLAN delivery audit](PLAN.md#browser-delivery-audit) and linked current-behavior documents for delivered features and remaining gates.

This is the analysis workstream for the sequential plan. It describes proposed
work against the current code, rather than claiming the proposals are implemented.
The project-wide plan should interleave the source-memory, editing and performance
work from [next steps](next-steps.md) and new CantorDust research with these stages.

## What already exists

`src/recipes/recipes.js` validates serializable expressions and compiles a shared DAG with
`f32`, exact `index`, `vec2` and `vec3` nodes. It already supports byte lookups,
parameterized entropy, global spectrum components, arithmetic, named references,
and explicit Hilbert coordinates. Only active channels contribute provider
requirements. `src/recipes/recipe-shaders.js` emits GLSL/WGSL libraries; actual provider reads
and recipe execution in the renderer currently remain on CPU. An operation should
have consistent emitter semantics without requiring a new GPU renderer first.

`src/data/point-factors.js` supplies population inputs and lookup contexts. It currently
reads a selection-sized byte buffer, entropy halos, and dense entropy results.
Byte and explicit entropy lookup addresses are selection-relative; entropy's
neighborhood uses root-source context. Outside-selection lookup results currently
return zero. Tuple populations use their first occurrence, and bin points have a
byte correspondence. These are relationships, not restrictions on which analysis
may shade which population.

`src/inspection/point-inspection.js` replays the same recipe evaluation for the hit mark and
attaches on-demand descriptions from `src/inspection/point-provenance.js`. `src/inspection/inspection-content.js`
renders these descriptions as text in collapsed sections. No new analysis should
attach a large provenance object to every prepared mark.

The [byte differences](byte-differences.md), [lagged coordinates](lagged-coordinate-plots.md)
and [entropy contrast](multiscale-entropy.md) examples already use supported
expressions. Their missing work is discoverability/reuse and acceptance fixtures,
not another statistical provider. Named localStorage presets already persist
these expressions, and profile imports already validate them atomically.

## Sequencing and release boundaries

Each stage should leave a useful, independently testable feature. A stage number
is an implementation order, not a promise to complete every extension in one pass.

| Stage | Useful result                                                             | Dependencies                                   | Later extensions kept separate                 |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| 1     | Reusable difference, delayed-coordinate and entropy-contrast examples     | Existing recipes                               | General parameter editor, preset proliferation |
| 2     | Compact bit extraction, XOR and population count                          | Stage 1 fixtures; compiler/emitter integration | Rolling bit statistics                         |
| 3     | UTF-8 interpretation in clicked-byte inspection                           | Existing inspection freshness contract         | UTF-16/32, graphemes, text factors             |
| 4     | Explicit validity and complete-span reads; integer numeric interpretation | Existing byte context; precision contract      | Float classification, float64/int64            |
| 5     | One scoped first-order conditional model                                  | Validity; raw pair counts                      | Sliding or higher-order training               |
| 6     | One-lag equality/difference, then mutual information                      | Validity; shared pair-model lessons            | Automatic lag search                           |
| 7     | Local distribution change                                                 | Validity; window-read strategy                 | More metrics and automatic segmentation        |
| 8     | Rolling bit bias/entropy                                                  | Bit operations; window-read strategy           | Broad collections of redundant factors         |
| 9     | Bounded exact previous-block matching                                     | Explicit provider budgets; validity            | Longest-match search, approximate indexing     |
| 10    | Local spectral band energy                                                | Provider budgets; frame cache                  | Spectrogram populations, GPU transforms        |
| 11    | Wider text/numeric interpretations and occurrence reductions              | Stable span/validity/provenance model          | Structured-record parsing                      |

Sparse byte/entropy work should proceed before extending large-source statistical
features broadly. It need not block a bounded first implementation of a direct
operation or an on-demand decoder. Developer benchmarks should measure new
providers as they land, rather than waiting until all ten families exist.

## 1. Make current recipes usable

Use small pure expression factories if several examples need the same construction;
keep them plain data and avoid a new language. An initial delivery can add named
recipe examples plus an importable preset, with exact expected inputs/outputs in
tests. If exposed in menus, put examples under an existing source/transform choice
and preserve population and unrelated channels when applying one. Do not create a
new top-level preset for every combination of lag, window and mapping.

Difference uses representative byte reads with signed normalization; delayed
coordinates use explicit `offset + lag` addresses; entropy contrast converts
normalized results back into bits before subtraction if a bits comparison is
intended. Preserve the existing 32-byte quantization. Masks must explicitly hide
missing predecessors/tails; rounded average bytes cannot replace actual reads.

Acceptance: constant/ramp/record fixtures, negative intermediate arithmetic,
large exact offsets, boundary masks, profile round trip, and a popup showing each
resolved source address. Existing `tests/recipes.js`, `tests/point-factors.js`,
`tests/point-inspection.js` and menu/browser tests are the integration points.

## 2. Compact byte bit operations

Implemented first increment: `bit`, `popcount` and `xor` expressions now share
clamped/floored byte conversion (nonfinite operands become zero), CPU evaluation,
GLSL/WGSL emission, menu controls and raw recipe tracing. Exhaustive byte/pair
checks live in `tests/bit-recipes.js`; executed GLES fixtures cover ordinary,
clipped and nonfinite operands. Rolling bit statistics remain pending.

Add only useful primitives, for example byte-width XOR, bit extraction and
population count. Define what constitutes their input: raw integer byte values
in 0–255, with an explicit policy for noninteger/out-of-range arithmetic inputs.
Do not let JavaScript's signed 32-bit coercion accidentally establish the policy.
Bit indices are constant integer parameters in 0–7 initially.

Touch `src/recipes/recipes.js` validation, node interning, evaluator and `recipeLabel`;
`src/ui/recipe-menu.js` transformation/parameter controls; and `src/recipes/recipe-shaders.js`
GLSL/WGSL generation. Arithmetic-only nodes need no `src/recipes/factor-catalog.js` slot and
no statistical provider. Hamming change composes XOR and population count over
two ordinary byte reads; normalize the raw count by eight explicitly.

Exhaustively test all 256 bytes and all 65,536 byte pairs against a direct bit
count. Add executed GLSL parity tests, shared-node reuse, profile serialization,
and provenance showing the two reads and raw bit result. WGSL generation alone
is not an executed-device test. The `7F`→`80` fixture should make the visual
difference from numeric subtraction immediately observable.

## 3. UTF-8 inspection without whole-source decoding

Implement a small pure decoder that finds a well-formed scalar containing a
clicked absolute byte, including a continuation byte. Read a clipped root-source
neighborhood of at most three bytes before and after that byte. Candidate starts
are bounded; reject overlong encodings, isolated continuation bytes, surrogates,
values above U+10FFFF and truncated sequences. A genuine encoded replacement
character is a valid result; decoder-generated replacement is not.

Integrate the bounded asynchronous read after hit resolution in
`src/inspection/point-inspection.js`, retaining `current()` checks before publishing a result.
Keep the pure decoding independent from DOM and Blob. Return encoding, scalar,
exact half-open span, source bytes and within-sequence byte index; render through
existing collapsed inspection sections. Do not change ASCII fields or gate valid
candidates behind a file-wide classifier. A bin's byte correspondence can carry
this interpretation, but the interpretation must not be labeled as the frequency
coefficient's character. For averaged marks choose the real representative byte
and identify that choice instead of decoding an averaged numeric value.

Use all fixtures in [multibyte ideas](<MULTIBYTE ENCODING IDEAS.md>), clicks on every
byte, selection crossings, root edges, encoded controls, and stale/canceled reads.
No profile version change is needed for an inspection-only interpretation.

## 4. Validity and numeric spans

Introduce explicit availability as an additional projection for new measured
reads. Do not change legacy `byte` zero-fill behavior. A minimal scalar validity
operation for a complete addressed byte span can serve integer words and missing
lag inputs; family-specific providers can expose their own validity projection.
Avoid a general nullable runtime or metadata object allocation per point.

Start numeric reads with `uint16`/`int16`, then `uint32`/`int32`, both endian
orders, using native DataView. Keep addresses as exact `index` arithmetic and
require the full span inside an explicit scope. Unaligned reads are useful and
should be allowed; alignment belongs to the address recipe. A trailing partial
word is unavailable, not zero-padded.

The IR rounds scalar intermediates to float32. Therefore uint32/int32 cannot
simply enter an ordinary scalar before exact range normalization: e.g. adjacent
large integers would collapse. Preserve an exact raw integer using existing
index-compatible storage or implement a read projection that normalizes from the
raw Number before f32 conversion. Do not claim exact integer behavior without
such tests. Existing recipe numeric parameter limits of ±1,000,000 also need a
specific decision for full-width numeric bounds; do not globally remove limits
without checking every operation and serialized importer.

Then add float32 with separate finite/NaN/infinity/negative-zero projections,
raw bits and value. A nonfinite value must remain distinguishable from a measured
zero despite the terminal output guard. Keep float64 and integer64 deferred until
raw precision, normalization and serialization have an agreed contract.

Extend provider requirements/context in `src/recipes/recipes.js` and `src/data/point-factors.js`, and
add exact-byte descriptions in `src/inspection/point-provenance.js`/`src/inspection/point-inspection.js`. A pure
numeric helper can serve inspection and provider evaluation. Save only definition
parameters, never DataView/runtime instances. Test all integer endpoints, endian
orders, unaligned/page-crossing reads, incomplete words, float subnormals and
special values, exact offsets above float32's adjacent-integer range, and import
rejection of malformed parameters.

## 5. Conditional surprise

Begin with one selected-interval first-order model, positive additive smoothing,
and probability/surprise/validity projections. Fit only transitions wholly inside
the selection. Preserve raw bits because observed surprise can exceed eight;
normalization/capping belongs to an explicit display expression.

`src/analysis/histograms.js` already computes raw pair counts and can be reused when scope and
ownership agree. Keep immutable prepared model data separate from mutable
incremental histogram scratch. Derive 256 row totals from the 65,536 pair cells;
reuse one model across channels and points. Float64 counters cost about 512 KiB
for the joint table and should have an exact-count bound. Do not reuse the
nonlinear display occurrence factor as if it were an exact count.

Cache by source identity, selection and smoothing/model parameters, not camera,
footprint or preset. An unseen row with smoothing gives a uniform distribution;
the first selection byte is unavailable. Inspection must say the model is fitted
on the scored interval, which makes this descriptive rather than held-out
prediction. Validate repeated ramps versus noise, injected altered transitions,
short selections, raw probability/counts and sampling-independent exact counts.

## 6. Lag comparison before lag search

Deliver one positive lag with comparison count, equality and mean absolute
difference first. A selected-scope aggregate is the smallest preparation change;
a local-window variant needs explicit window positioning and context scope.
Only count pairs with both real bytes available. Reuse pair-reading/window work
across outputs. Camera, grid width and sampling must not redefine the lag.

Add mutual information only after joint/marginal counts are inspectable. Keep
raw bits; a constant stream has equality one but mutual information zero. Any
normalized information measure needs a defined zero-entropy status. Large joint
tables for every center/lag must never be cached by default. Automatic best-lag
search follows as its own feature with a serialized tested set, tie policy and
harmonic ambiguity, after measured single-lag costs.

Reference tests: direct loops on known records, alternating data, relabeled
patterns, lag larger than available input, clipping and cached/fresh equivalence.

## 7. Distribution change

Start total variation, with two independently normalized 256-bin histograms,
explicit window/gap/scope and validity for empty sides. Use the documented
half-open left/right windows; the addressed boundary is in the right window when
gap is zero. It is already a bounded 0–1 metric. Add Jensen–Shannon divergence
later under a distinct serialized metric, keeping divergence and distance names
unambiguous.

Implement a direct reference algorithm first. For dense windows maintain rolling
counts and changed metric contributions; at clipped edges, recalculating 256
contributions is an acceptable initial policy. Sparse lookups should share
neighborhood reads and results without allocating one score per source byte.
Retain counts only where useful; inspection can reconstruct a single neighborhood.
Acceptance: identical distributions in different orders score zero, disjoint
alphabets score one, and unequal clipped window lengths normalize separately.

## 8. Rolling bit statistics

One shared window scan can maintain eight set-bit counters. Expose bit bias and
binary entropy as distinct projections with actual count, scope and clipping.
A constant-one bit has bias one and entropy zero. Reuse the window cache/paging
policy from existing neighborhood work; do not rescan a window independently for
each bit/channel. Validate direct/rolling equality and dense/sparse equivalence,
including incomplete neighborhoods. This stage should follow evidence that the
compact bit operations reveal useful structure.

## 9. Exact repetition under a real budget

Begin nearest previous exact four-byte block with configured history and overlap
policy. Pack a key into an unsigned 32-bit value; query before inserting the
current start. Expire history safely without deleting newer occurrences of the
same key. For nonoverlap, delay eligibility or preserve eligible starts; rejecting
only the latest overlapping match misses older valid matches.

Keep exact distances/addresses out of float32 until explicit normalization. Index
memory grows with distinct history keys, and sparse queries may still require a
prefix scan. A provider budget must report/reject unsupported exact work rather
than silently shorten history. Do not call an arbitrary bounded eviction exact.
Stage cancellation and cache publication so a partial scan cannot poison the
next request. An initial implementation may answer only requested positions while
scanning required history once; it need not retain a source-length result array.

Later match extension reports the chosen candidate's length, not the global
longest match. Hashes for longer keys require byte verification. Test expiration,
overlap, nearest-versus-older-longer choices, incomplete trailing blocks and
large exact distances. Inspection should expose both real matching spans.

## 10. Local spectra as factors

Reuse `src/analysis/fourier.js` for an explicit local transform; do not route through the
global selection-spectrum cache with different semantics. Define frame length,
hop/origin, window convention, detrending, scope, edge policy and cycles-per-byte
band endpoints before implementing the first band-energy/validity outputs.

Deduplicate requested frames and retain bounded reductions rather than a complete
frame×bin matrix. Include endpoint weights for a one-sided real spectrum, explicit
DC inclusion, and a zero-power validity policy. A bin point consulting this
provider needs both its frequency and an explicit byte-to-frame relationship;
global and local bin ordinals are not interchangeable.

Cache frame coefficients only within a provider budget, or recompute an inspected
frame for detail. Never shorten a transform as a hidden memory fallback. Compare
small frames with independent direct DFT sums, verify odd/even endpoint scaling,
known frequency changes, clipping/padding and cache reuse. A dedicated spectrogram
population and GPU transforms are separate later stages.

## 11. Expand interpretation and occurrence relationships

After UTF-8 spans work, add UTF-16LE/BE and UTF-32LE/BE candidates with explicit
alignment/origin; permit valid local alternatives without requiring a BOM. Keep
code-point spans before graphemes, and do not normalize source text. Grapheme
segmentation needs bounded-context/truncation rules before claiming completeness.

Text-derived shading can reuse the explicit span/validity provider contracts but
is a separate performance feature from inspection. Numeric float64/integer64 and
record populations likewise require precision/enumeration contracts, not a new
exclusive analysis domain.

First/last tuple representatives can be collected while enumerating tuples
without retaining every occurrence. A reduction such as mean entropy must
measure each occurrence, rather than lookup once at an average address. Make
this an explicit expression relationship and budget extra scans/index storage.
Spectral interpolation should likewise specify nearest/interpolated policy and
raw quantity; interpolating wrapped phase directly is generally inappropriate.

## Shared completion checks

Every new family should have:

- A direct numerical oracle on tiny deterministic fixtures and a visual fixture
  that answers a distinct useful question.
- Boundary/validity tests independent of camera, sample limit and point population.
- Reachability tests proving unused outputs do not allocate new providers.
- Cache freshness, cancellation and source-replacement tests, including a stale
  inspection response.
- Serialization/import validation, named-reference behavior and UI parameter tests.
- On-demand provenance explaining source spans, raw values, scope and mapping.
- Measured cold/warm preparation time and retained buffers at fixed sparse sample
  count as selection size grows. Exact global scans must be identified explicitly.

Do not require a broad provider registry, nullable type system, expression DSL,
worker pool or preset-specific painter to implement these stages. Extract shared
helpers when two real providers need the same range/count operation; keep the
serialized analysis meaning independent from its dense or sparse execution path.
