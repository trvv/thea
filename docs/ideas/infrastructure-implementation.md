# Infrastructure implementation sequence

Historical planning baseline: implementation has since advanced. Consult the [PLAN delivery audit](PLAN.md#browser-delivery-audit) and linked current-behavior documents for delivered features and remaining gates.

This is a code-informed planning input to the combined [plan](PLAN.md), not a
second implementation track. It covers the infrastructure and interaction work
in [next steps](next-steps.md), [the roadmap](roadmap.md), and the performance
limitations in [rendering](../rendering.md). Analysis-specific algorithms belong
in the companion [analysis implementation notes](analysis-implementation.md).

## Current state to preserve

All configurations already share provider preparation, compiled recipes, geometry,
appearance, projection/order and CPU/WebGL raster stages. There is no remaining
preset painter to remove. Populations determine marks without restricting which
providers recipes can consult. Explicit per-dimension ranges, Fit and
Scale/Truncate are implemented; the old Layout setting is gone.

Named localStorage presets, explicit updates, duplication, rename/delete,
clipboard JSON import/export and selected-preset restoration are also implemented.
The save/load milestone in the older next-steps document is therefore complete.
Source bytes, URL and selected ranges are deliberately outside reusable presets.

Current optimizations include structural recipe reuse, source-only lowering,
exact bounded color tables, opaque square row fills, incremental histograms,
selection spectrum reuse, separate geometry/appearance/projection caches,
bounded render queues and adaptive raster resolution. New work should extend
these stage boundaries rather than create another execution model.

The principal remaining constraints are concrete:

- `src/data/point-factors.js` reads a whole selected window whenever byte-backed work is
  reachable, including default entropy shading. Sampling limits prepared marks,
  not that read or the entropy result arrays.
- `src/data/populations.js` discovers every distinct tuple and retains its first address
  before sampling; a low sample limit does not bound distinct tuple discovery.
- `src/render/overview.js` retains up to 64 prefix pages per bar/cache, plus page totals.
  Several bars and workers can duplicate the same source summaries.
- `src/render/point-renderer.js` reports broad preparation, projection, sorting and raster
  timings. Provider preparation and recipe evaluation are not distinguished.
- `src/render/point-webgl.js` rebuilds an interleaved instance buffer and uploads projected
  marks each draw. Providers, evaluation, camera projection and order stay on CPU.
- Cancellation checks follow awaited reads. Long synchronous loops do not become
  interruptible merely because a newer request exists.
- Named-factor editing has `setFactor`, but no atomic rename/delete operation or
  edit history. A deep menu is still the expression editor.

## Recommended order

| Stage | Deliverable                                         | Prerequisite                              | Why this position                                                        |
| ----- | --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| I1    | Provider and end-to-end measurements                | None                                      | Establish actual bottlenecks before choosing larger execution changes.   |
| I2    | Reachable sparse byte/entropy preparation           | I1; explicit lookup analysis              | Bound a common cost that new analyses would otherwise multiply.          |
| I3    | Chunked exact scans and memory estimates            | I1; provider contracts from analysis work | Keep full-selection statistics honest and usable at larger scales.       |
| I4    | Shared immutable overview pages                     | I1; source ownership decision             | Reduce duplicated work independently of the factor system.               |
| I5    | Explicit tuple representative policies              | Population/provenance fixtures            | Improve mixed-analysis meaning before adding expensive reductions.       |
| I6    | Factor transactions and compact editing             | Existing validated profile API            | Make additional analyses practical to configure and recover.             |
| I7    | Dependency-specific buffers and generic grid kernel | I1 measurements; stable providers         | Recover common throughput without preset dispatch.                       |
| I8    | Persistent GPU buffers, then camera projection      | I1 and I7 measurements                    | Spend complexity only where uploads/projection dominate.                 |
| I9    | Device coverage and source extensions               | Concrete environments/workloads           | Validate acceleration and broaden access without speculative frameworks. |

Analysis features can land between these stages. They should not wait for GPU
execution, a worker pool, cross-worker caches or a new expression language. A first
conditional-surprise provider, for example, can use exact selection scans while
I2 handles unrelated sparse byte and entropy lookups.

## I1. Measure work without changing the page

Extend the existing render result and `RenderEngine.reportFrame` data, not the
visualization UI. A small optional diagnostics object can accumulate coarse
provider timings, bytes read, cache hit/miss counts and retained typed-array
storage. Time loops once, never each point. Separate source-read latency from
entropy/count/FFT CPU time, and separate provider preparation from recipe visits.

The hot cache-hit path should not rediscover every buffer recursively. Providers
know which buffers they own and can report them when created/replaced. Count a
shared ArrayBuffer once: a selected subarray and its halo buffer do not represent
two allocations. Map entry counts are useful, but do not label an estimated Map
footprint as exact retained bytes. Distinguish retained storage from peak FFT
working estimates and per-job temporary allocations.

At the engine boundary count requested, superseded pending, started, completed,
rejected, discarded and presented jobs. Existing callback `duration` starts at
execution, so add enqueue-to-presentation latency separately. A worker result
arrival and visible canvas composition are different observations; avoid claiming
an exact browser compositor presentation timestamp from `drawImage` alone.

Add deterministic report fixtures for repeated/random tuples, long sparse
selections, radix-2/prime-length transforms, several nested bars, opaque and
translucent marks, text and high DPR. Keep old/new comparisons on the same
machine. No universal FPS assertions; tests should assert that counters and
invalidation behave correctly, while benchmarks report timings.

**Acceptance:** a warm camera frame reports zero new provider reads; changing only
hue does not rebuild geometry; a large sparse byte/entropy fixture exposes its
current selection-sized storage. Local and worker results contain equivalent
serializable diagnostics. Diagnostic collection can be disabled.

## I2. Prepare predictable sparse reads exactly

Start with representative byte-population sampling and expressions whose byte
addresses are known from offsets, constants and simple index arithmetic. Determine
requested source pages and entropy halos before synchronous recipe evaluation.
Merge overlapping ranges, deduplicate reads and publish only completed pages.
Use bounded page caches scoped to immutable source identity and analysis
parameters. Keep the current dense implementation as the reference and fallback.

There are important restrictions to make explicit:

1. Default `sampling: 'average'` can make a displayed byte value or built-in
   entropy average cover an entire sample bucket. Fetching only its representative
   byte would silently change the image. Start sparse work with representative
   sampling; exact averaging needs streaming sums or reusable summaries.
2. A byte lookup whose address depends on a previously read byte cannot be fully
   planned with one static pass. Retain dense fallback first; a second preparation
   pass is an optional later optimization. Synchronous recipe instructions must
   not initiate asynchronous reads.
3. Entropy uses root-source context beyond the selection, while byte lookups are
   selection-relative and zero outside it. Sparse pages must preserve both.
4. Built-in 32-byte entropy has an 8-bit quantization contract. A mathematically
   similar Float32 entropy result can still change colors; compare against the
   actual existing byte-valued result.
5. Global counts, tuple discovery and FFTs retain exact scan/global requirements.
   A sparse byte read strategy does not make their answers sparse by accident.

Add provider request metadata to compiled plans only for operations that need it.
Avoid exposing a generic task scheduler or replacing Blob with a wrapper. Route
inspection through the same access contract so on-demand traces can explain a
sparse-prepared mark without assuming `provenance.bytes` is a full selection.

**Acceptance:** dense/sparse values and final pixels agree at file/selection edges,
for even/odd windows, nonzero offsets, shared windows and hidden axes. Fixed sparse
mark counts do not retain selection-sized byte/entropy arrays as source length
grows. Cancelled reads cannot publish partial pages or obsolete prepared marks.

## I3. Bound scans and make global costs visible

`windowCounts` already streams a full scan when selected bytes are absent; stop
forcing the full `factorWindow` merely to feed it. Preserve byte/pair count tables
as Float64 counts; an unconditional Uint32 table would reduce count range.
Triple Maps remain data-dependent. Evaluate dense storage only after measured
occupancy and explicit count-width accounting, rather than automatically spending
64 MiB for every triple analysis.

Incremental tuple representatives are harder than incremental counts: removing a
first occurrence can require finding its replacement, and changing representative
order can alter which tuples are sampled. Begin with bounded streaming discovery
that preserves current first-occurrence order. Then consider per-key occurrence
queues or a second scan only if scrolling measurements justify their memory.

For synchronous long scans, bounded chunks and a current-request check only help
if the event loop can observe new work. A worker processing a synchronous loop
cannot see a queued cancellation message. Yield between suitably large chunks
before checking an updated revision; measure throughput versus cancellation
latency. Preserve the one active/one pending scheduling policy. Do not add a
worker pool or SharedArrayBuffer as the first response.

Histogram incremental changes must remain atomic. The current implementation
stages reads before modifying counts; introducing yields inside the mutation
loop needs a staged delta/commit rule or safe rollback. Do not leave a cancelled
half-subtracted histogram reachable by the next frame.

Estimate FFT radix-2/Bluestein working memory before allocation. A configurable
provider budget should reject an unaffordable exact operation through the normal
error path while keeping the last usable view. Shorter transforms, downsampling
and localized spectra are separate explicit analyses, never silent fallbacks.

**Acceptance:** counters show bounded input buffers for scans, exact counts across
chunk boundaries, stable tuple order and no cache poisoning under cancellation.
Memory-estimate rejection happens before large allocations and does not mutate
the active profile or current presented frame.

## I4. Share overview summaries within one context first

Use a WeakMap keyed by the root Blob for shared immutable prefix pages, page
totals and in-flight read promises. Keep per-bar frame/raster keys in each bar's
cache. Source identity must remain the Blob inside that execution context:
engine-local `sourceId` values are not global identifiers, and cloned Blobs in
separate workers do not share WeakMap identity.

Share completed read results even if one consumer becomes obsolete; each
consumer checks its own currency before composing a frame. A cancelled consumer
must not cancel another consumer's needed read. Remove rejected promises so a
later request can retry. One LRU budget should cover the shared detailed pages,
with separate accounting for retained coarse totals. Source replacement naturally
separates keys; ensure no unrelated source is retained by an unbounded strong map.

This produces a real gain for bars in the same context. Existing per-canvas
workers can still duplicate summaries. Record that limit; do not promise all-bars
deduplication until ownership is actually shared. A source summary worker or
host-supplied immutable summaries are later alternatives whose transport cost
must be measured.

A second level of exact block summaries can reduce repeated boundary detail reads
on large scopes. It still needs an initial scan. Keep exact sum accumulation safe
for JavaScript integers; do not assume arbitrarily large block sums fit Uint32.

**Acceptance:** overlapping concurrent bars read a page once in one context;
results match direct byte sums for partial pages and subpixel bins. Test failed
read retry, one cancelled waiter, LRU eviction, new sources and bounded retained
storage. Use `tests/scroll-performance.js` as the existing reference location.

## I5. Make occurrence relationships explicit

Add an optional serialized tuple representative setting with current first as
default and last as the first new choice. Distinct tuple ordering should remain
first-encounter order even when its chosen representative changes; otherwise the
same sample limit changes both population membership and address relationship.
Store tuple key and chosen address separately if needed to preserve this rule.

Last occurrence can be collected in the same scan without retaining all addresses.
A midpoint occurrence means the median occurrence by ordinal, not an average byte
address; defer it until an occurrence index or a deliberate second pass exists.
Keep byte-local recipe evaluation relative to the chosen occurrence and expose
the policy/address in point inspection. Tuple value/count semantics remain exact.

Follow with one explicit reduction, such as mean entropy over all occurrences.
It needs a provider request that names the expression/window and population
relationship. It is not entropy at an average address. Use streaming count/sum
accumulation when possible; retain occurrence lists only on demand and within a
budget. Nearest/interpolated spectral lookups are independent expression options
with their own boundary contract, not a global tuple representative setting.

**Acceptance:** one tuple with occurrences in dissimilar contexts changes its
byte-local shading under first/last while key/count and selected range stay
fixed. Mean entropy differs from representative lookup as expected. Save/load,
worker cloning, settings identity and inspection preserve all new parameters.

## I6. Add atomic editing before a bigger editor

First implement pure named-definition rename/delete helpers. Rename should rewrite
references in definitions, active position expressions and appearance mappings,
then validate the entire proposed profile before committing it once. Detect
name collisions. Deletion should initially reject referenced factors; replacing
references with zero or silently inlining them would hide an analysis change.
Unreferenced deletion is straightforward.

Use the existing owned profile snapshot as an edit transaction boundary. A bounded
undo/redo history can store profiles, excluding source/range navigation and preset
library CRUD. Coalesce an input drag into one edit when practical. Restoring a
profile must use the same validation and source-selection-preserving path as
import, and invalidate pending render/inspection identities normally. Avoid
making every render or navigation step an undo entry.

A compact JSON editor for one expression or an entire profile can reuse
`validateRecipe`, `validateDefinitions` and profile validation. Show errors only
when an explicit edit fails; avoid adding instructional page copy. Keep the
serialized recipe format independent of the editor. Parameterized recipe
snippets can begin as ordinary functions producing recipe objects, without a DSL.

File import/export is an optional extension to current clipboard transfer: read
one user-selected JSON file, validate first, resolve its name explicitly and save
through `src/presets/preset-library.js`; export a Blob download with the existing JSON shape.
Source bookmarks are distinct from reusable presets. If implemented, specify
source identity and unavailable-source behavior rather than saving arbitrary
local file paths or source contents in localStorage.

**Acceptance:** indirect references rename atomically; referenced deletion leaves
the profile unchanged; invalid JSON and migration failures preserve active state.
Undo/redo works across factor, dimension and appearance edits, restores current
inspection freshness and never seeks to an old source window unexpectedly.

## I7. Improve shared CPU work by dependencies

Use I1 reports to choose between these two independent increments:

- Split appearance dependencies so changing opacity need not rebuild RGB, and a
  size edit need not rerun providers used only by hue. Current geometry reuse is
  already implemented. Cache keys should follow reachable compiled dependencies;
  all named definitions currently appear in configuration identity, so editing
  an unrelated definition can invalidate more work than necessary. Do not weaken
  full settings identity used to reject stale presented frames.
- Add a fused regular-grid kernel only for a precisely recognized combination
  of coordinate, appearance and coverage properties. It must be eligible for
  any preset/custom profile satisfying those properties. Keep reference fallback
  for fractional cells, overlap, clipping, alpha, text and unsupported recipes.

Generic dirty-region updates are a later extension. Moving a selection can change
entropy halos, global counts and normalization throughout the frame; overlapping
source bytes do not imply unchanged pixels. Recompose all affected ordered
contributions for transparent overlap rather than updating a single owner mark.

**Acceptance:** optimized/reference pixels agree over randomized small fixtures,
not only built-in screenshots. Counters establish that the intended stage was
skipped. Measure end-to-end gain and retained buffers on dense grid and mixed
configurations; keep the optimization only if it justifies its maintenance cost.

## I8. Move camera work to GPU only with a defined contract

A small first step is retaining upload buffers across unchanged prepared revisions,
not immediately executing recipes on GPU. Separate position/color/size revisions
so camera-only frames can use persistent attributes. The existing WebGL raster
uploads projected instances in depth order each frame; replacing that requires a
specific ordering/coverage design.

Opaque point alpha does not imply every pixel is opaque: four-probe edge coverage
creates fractional alpha and rear contributions. Ordinary depth-tested quads
therefore do not preserve the current CPU reference at edges. Begin with a
restricted fully covered opaque case, or retain CPU depth order and reproduce
coverage explicitly. Document any new rendering semantics as an opt-in rather
than quietly changing existing WebGL output.

GPU camera projection also does not eliminate CPU sorting if translucent order
still depends on camera depth. Measure whether duplicating a cheap depth
calculation for sorting offsets the projection gain. Keep CPU hit testing or a
matching on-demand projection available for inspection of the displayed frame.

Only then bind simple byte-backed/provider-free recipe IR to GPU buffers. Shader
index arithmetic is signed 32-bit while CPU indices are safe integers. Validate
eligibility and fall back before precision loss. Upload statistical provider
outputs by selection/definition revision; camera motion must not rebuild FFTs.
WebGPU compute, FFTs and histograms are separate projects requiring real device
measurements, not automatic consequences of WGSL function emission.

**Acceptance:** camera-only frames show fewer uploads and lower measured latency;
context loss, capability limits, resize and stale jobs fall back correctly. CPU
reference and browser fixtures cover fractional boundaries, overlaps, depth ties,
shape, clipping and inspection. Do not automatically select a backend from a
single cold measurement.

## I9. Validate environments and broaden sources deliberately

Maintain a small manual device matrix alongside repeatable Chromium tests:
CPU on Firefox/Safari first, then workers and accelerated contexts where supported;
integrated/discrete physical GPUs separately from SwiftShader. Record browser,
backend actually used, DPR and device. Fallback success is not GPU success. Use
numerical/coverage tolerances per operation; do not demand identical cross-platform
font rasterization.

HTTP Range, live streams, structured records and a worker pool remain explicit
later branches. For Range sources, require total size, immutable version identity,
range validation, cancellation and cache rules before replacing Blob. For streams,
specify whether old offsets remain readable and how finite selections behave.
Structured numeric reads can be recipes over Blob before introducing record
populations. Do not add a wrapper that merely renames Blob methods, or let a new
source type change the meaning of existing selected offsets.

## Checks applying to every stage

Extend the tests that own each contract rather than creating snapshot-only tests:
`point-factors`, `recipes`, `point-inspection`, `render-pipeline`, `render-engine`,
`scroll-performance`, `preset-library` and the browser suite as appropriate.
Every new serialized parameter must survive profile validation, import/export,
worker structured cloning, cache identity and stale-frame rejection. Hidden or
unused providers remain lazy. Keep correctness fixtures small and deterministic;
performance reports use larger representative fixtures and avoid timing gates.

Run `bun fmt src` before final checks and committing; use `bun fmt --check src` to verify. No new on-page
performance labels or explanatory UI are needed for this infrastructure work.
