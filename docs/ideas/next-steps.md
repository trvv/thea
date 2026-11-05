# Next steps

These are proposals following the pipeline improvements in `77148df`, not a list
of features already implemented. The [pipeline contracts](../pipeline.md) describe
current behavior; the [roadmap](roadmap.md) gives the broader direction.

Implemented since this proposal: the global Layout layer has been removed.
Presets declare coordinate mappings; each dimension has ranges/steps, Scale or
Truncate, and independent Fit (on by default). Profile version 3 migrates the
previous arrangement settings. See [dimensions](../dimensions.md) for the current
model. The proposals below retain their original priority rationale.

The preset painters have since been removed as well. All view configurations now
share provider, recipe, geometry, appearance, projection/order and raster stages.
Geometry and projection/order reuse is independent of appearance edits; simple
source graphs, exact conditional color tables, and opaque square row fills are
shared optimizations. Developer frame metrics expose preparation, projection,
sorting and raster timings. See [rendering](../rendering.md) for current cache
boundaries, benchmark usage and remaining dense-grid overhead. Preparation still
combines provider reads/calculation and recipe evaluation, so finer instrumentation
and sparse providers remain useful next work.

The guiding constraint is composability: point population determines which marks
exist, while each analysis keeps its own scope and sampling relationship. Byte,
tuple, spectral, and contextual analyses should remain freely mixable. Prefer
small changes with measurable benefits over a general execution framework.

For additional analysis proposals and current-recipe experiments, see the
[ideas index](README.md). Those expand what can be measured; the work below mainly
improves execution, editing and relationships between existing measurements.

## Suggested order

| Priority | Work | First useful result |
| --- | --- | --- |
| 1 | Measure provider and frame costs | Identify which stages dominate time and retained memory on representative inputs. |
| 2 | Bound provider preparation | Avoid allocating selection-sized results when only sampled lookups are needed. |
| 3 | Reuse overview summaries across bars | Reduce repeated reads and duplicate source summaries. |
| 4 | Move projection and expression work to GPU selectively | Improve camera interaction without changing analysis semantics. |
| Alongside these | Expand browser/device coverage | Establish where acceleration is reliable and beneficial. |
| Product decisions | Refine menus, profiles, and sampling relationships | Expose useful control without making routine exploration cumbersome. |

The order is provisional. Measurements should determine whether preparation,
sorting, rasterization, or transfer deserves the next performance change. Menu
and profile work can proceed independently of those measurements.

## 1. Measure the stages separately

Existing benchmarks distinguish cold preparation, camera-only rendering, and
scrolling. Extend that distinction into provider reads, histogram/entropy/FFT
preparation, recipe evaluation, projection, sorting, rasterization, and
transfer/presentation. Include end-to-end latency as well as individual stages:
worker execution time alone does not describe responsiveness.

Start with a developer-only benchmark/report interface. Do not add timings or
status labels to the visualization page. Keep instrumentation optional and avoid
per-point timing calls. Record requested, completed, discarded, and presented jobs
so fast execution cannot hide a large amount of obsolete work.

Use deterministic fixtures that exercise different costs:

- Repeated bytes and repeated tuples, where aggregation is effective.
- Pseudorandom data, where distinct-tuple storage grows quickly.
- Long selections with small rendered sample counts.
- Power-of-two and nearby non-power-of-two FFT lengths.
- Multiple nested bars and scopes larger than their detailed page caches.
- Opaque and translucent marks, text, high DPR, continuous scrolling, and rotation.

Measure cold and warm behavior separately. Report retained typed-array storage
explicitly; process-wide memory measurements are useful context but can fluctuate
with garbage collection. Browser timing should distinguish physical GPUs from
SwiftShader. Use relative comparisons on the same machine, not universal FPS
thresholds.

**Completion criterion:** a repeatable report identifies the dominant stage and
retained buffers for each fixture, with source reads and cache reuse visible.

## 2. Bound large-source provider work

The current sample limit bounds prepared marks and sorting. It does not bound
full-window byte reads, entropy arrays, FFT working buffers, or distinct-tuple
discovery. A small displayed sample can still require large preparation.

### Separate provider strategies

Different providers need different solutions. Introduce a small provider-specific
planning step only where there is a real alternative; avoid a generic scheduler
or new source wrapper just to express these choices.

For byte and neighborhood lookups, group requested addresses into pages and read
only those pages plus their required halos. Preserve selection-relative address
bounds and root-source context for entropy. Data-dependent addresses need a
separate policy: an expression may calculate its lookup offset from another
lookup. Support straightforward predictable cases first, and retain the full
window path as an explicit fallback.

For local entropy at sparse sample positions, compute requested neighborhoods or
entropy pages rather than retaining one value for every selected byte. Dense
requests should continue using the rolling linear-time implementation. Switching
between strategies must preserve file-edge normalization and quantization.

For histograms, streaming accumulation can bound byte-buffer memory even though
an exact result still requires a scan. Byte and pair count tables have fixed
sizes. Triple maps can grow with the number of distinct keys; evaluate a sparse
Map versus a dense 24-bit table based on measured occupancy and memory. A dense
Uint32 table alone occupies 64 MiB and has count-range limits, so it should not
become an unconditional allocation.

The FFT is a global operation. Paging its input does not make its working set
small. Estimate radix-2/Bluestein storage before allocating it and decide how a
host can set a provider budget. A shorter FFT, downsampled signal, or localized
spectrum changes the analysis and must be an explicit option, never a silent
response to memory pressure. Cached one-sided coefficients already avoid
retaining padded transform buffers, but peak transform memory remains.

### Bound cancellation latency

Supersession is currently checked around asynchronous reads; long synchronous
provider loops still run to completion. Measure wasted time before introducing
cancellation machinery. Start by dividing suitable work into bounded chunks with
checks between them. A worker cannot receive ordinary cancellation messages while
its event loop is occupied, so message-based cancellation requires yielding or a
different protocol. Keep histogram updates staged until they can be committed;
never leave a partially applied delta in a shared cache.

**First increment:** sparse byte/entropy preparation with exact equivalence tests
against the existing dense path, including source edges and cancelled reads.

**Completion criterion:** increasing selection length at a fixed sparse sample
count no longer increases byte/entropy result storage proportionally. Global
operations retain documented, separately measured costs.

## 3. Share immutable overview summaries

Each bar currently owns its own detailed page cache and coarse page totals.
Totals help whole-page contributions, and identical completed rasters are reused.
Changed ranges that need evicted partial pages can still cause repeated reads.
Nested bars also duplicate summaries of the same root source.

An incremental design is a source-owned summary service keyed by the immutable
root Blob. It would publish completed summaries, deduplicate concurrent reads,
and enforce an aggregate memory budget. Bars would keep their own raster and
selection state. Share immutable summaries, not mutable painter or worker caches.
A rejected or cancelled read must not remain a permanently cached failure.

First consider sharing inside one execution context. Cross-worker sharing is a
separate ownership problem: engine-local source IDs cannot be used as global
keys. A worker/service owning source summaries may help, but adds messaging and
transfer costs. Do not introduce SharedArrayBuffer, isolation requirements, or a
worker pool until those costs justify them.

For scopes much larger than the detailed cache, investigate multiple summary
levels. Whole blocks can contribute exact sums from coarse summaries; only
boundary fragments need finer detail. This can reduce reads without approximating
overview pixels. It still requires an initial scan, and retained summary memory
must be accounted for rather than described as free.

**First increment:** a source-scoped cache shared by multiple bars in the same
context, with read deduplication and an explicit total storage budget.

**Completion criterion:** adding overlapping bars does not multiply identical
summary reads or retained summaries, and every pixel still matches a direct sum.

## 4. Move more point work to the GPU selectively

The WebGL backend currently uploads projected marks. Providers, recipes,
projection, sorting, and text run on CPU. This is a useful baseline for measuring
the next step, not evidence that the entire pipeline should move to the GPU.

### Start with camera projection

Upload prepared positions, colors, and sizes once per preparation revision, then
change camera/viewport uniforms during rotation. An opaque path that does not
require ordered alpha blending is a promising first target. Coverage semantics
need care: the current four-probe coverage and ordered pixel blending are not
identical to ordinary depth-tested quads.

Translucent points still need ordering. Moving projection while retaining CPU
sorting may save less than expected because sorting needs camera-dependent depth
values. Measure that split rather than claiming projection removes all per-point
CPU work. Order-independent transparency is a distinct rendering tradeoff, not a
free replacement for the existing blend order.

### Then consider recipe evaluation

The emitted IR functions provide an entry point, but need actual factor/provider
bindings and uploaded buffers. Begin with provider-free or simple byte-backed
recipes, keeping statistics on CPU. Upload provider results only when their
selection/definition revision changes. Keep camera changes independent from
provider uploads.

Before executing index expressions on the GPU, enforce the emitted library's
signed 32-bit arithmetic bounds. CPU safe-integer addressing has a wider range.
Fallback or paging must be explicit; float conversion must not silently restore
the old neighboring-byte precision problem.

Keep the CPU renderer as a numerical reference and fallback. Test device limits,
context loss, failed allocation, resize, and disconnect. Avoid an automatic
backend chooser until cold startup, upload, and steady-frame measurements support
one. WebGPU compute for FFTs and histograms can wait for evidence that those
providers dominate and that a supported implementation is worth maintaining.

**First increment:** persistent position/color buffers and camera uniforms for a
carefully specified opaque point path.

**Completion criterion:** camera-only interaction avoids repeated geometry
uploads and shows an end-to-end gain, with documented coverage differences and
no weakening of source/configuration freshness checks.

## 5. Make sampling relationships more expressive

Tuple points currently use their first selected occurrence for byte-offset
analyses. That is deterministic and useful, but can hide variation among the
occurrences of the same tuple. Bin points similarly need a defined relationship
when consulting byte-local analyses.

There are at least two independent operations worth exposing:

- Choosing a representative address: first, last, midpoint occurrence, or an
  explicitly chosen occurrence.
- Reducing an analysis across occurrences: mean entropy, maximum amplitude under
  a specified mapping, or another explicitly defined statistic.

These should be scoped to the relationship that needs them. A global tuple
representative policy can supply a default, while individual expressions may
need another relationship. For example, a tuple could be positioned by its byte
values, colored by mean entropy across its occurrences, and given opacity from
its exact occurrence count. Reducing entropy across occurrences is not the same
as looking up entropy once at an average address.

Spectral lookup could support nearest-bin versus interpolation, and localized
spectra could expose window length, hop, alignment, and boundary handling. Those
parameters change the analysis and belong in its serialized definition. Do not
infer them from the active preset or renderer.

Do not retain every occurrence address by default. First/last positions and some
reductions can be accumulated with counts. More general reductions may need
additional scans or a dedicated occurrence index. Keep that cost demand-driven.

**First increment:** explicit first/last occurrence selection, followed by one
well-defined reduction with tests showing why it differs from a representative.

**Completion criterion:** a mixed-analysis example can express its intended
relationship without changing point population or activating unrelated providers.

## 6. Build profile management and improve editing

Version 3 JSON supports validated import/export. A modest next step is
named profile storage, duplication, rename/delete, and file import/export.
localStorage is adequate for small configurations; IndexedDB is justified only
if actual size or transaction requirements outgrow it. Keep reusable settings
separate from source URLs and selected ranges. Storage failures must leave the
current profile usable, and import/migration must validate before replacing it.

Prefer explicit save behavior initially. If autosave is added, keep a recoverable
previous version and distinguish the current session from a reusable named
profile. Add schema migrations when an actual format change exists, rather
than building a migration framework speculatively.

The context menu now exposes population, sample limit, footprint, and backend.
These are useful model controls, but they differ in how often users need them.
Review their names, grouping, defaults and reset behavior
before adding more controls. Model fields need not map one-to-one to permanent
top-level menu items. Backend is an execution preference; population changes what
marks mean; a sample limit changes which members are drawn. Their placement
should help users make those different decisions without adding explanatory page
copy.

Nested expression menus remain reasonable for small edits. For deeper recipes,
try a compact structured editor or validated JSON editing before adopting a graph
UI or textual language. Named-factor rename/delete needs dependency handling:
update references atomically or reject the change rather than leaving broken
recipes. An undoable edit transaction would also make exploration safer than
relying on preset reset to recover a previous configuration.

**First increment:** review the existing context-menu controls, then add explicit
profile save/load through the same validated API.

**Completion criterion:** users can recover and share a visualization after a
reload, while ordinary navigation and common mapping edits remain short paths.

## 7. Validate more browser/device combinations

Current browser checks cover Chromium with SwiftShader, including real
workers/bitmaps, WebGL/CPU comparison, context loss, DPR/text sizing, source
replacement, and native popover focus. This is not physical-GPU or cross-browser
coverage.

Separate functional checks from performance characterization. Run the same core
fixtures on a physical integrated GPU and, when available, a discrete GPU. Add
Firefox and Safari checks for the component and CPU paths first, then accelerated
paths where the required worker/context capabilities exist. Missing acceleration
should exercise fallback rather than fail unrelated component tests.

Expand pixel comparisons around angular seams, clipping, overlapping transparent
marks, depth ties, and larger mark sizes. Keep numerical tolerances specific to
the operation and blending behavior. Font rasterization should use layout and
legibility checks rather than exact cross-platform glyph pixels.

Record browser version, backend, device, DPR, and whether GPU execution was
actually used. A passing fallback test is not proof that the accelerated path ran.
Device coverage can guide backend defaults later; it should not require adding
product UI or runtime dependencies today.

**Completion criterion:** the supported CPU path behaves consistently across
browsers, and accelerated behavior has documented device results and reliable
fallback tests.

## Work to defer until a concrete need appears

HTTP Range sources, live streams, structured-record decoding, WebGPU compute, a
node-graph editor, and a generalized worker pool are plausible extensions. None
is a prerequisite for the steps above. Revisit each with a specific workload and
an ownership/cancellation/offset contract. Continue using native Blob and plain
serializable configuration wherever they already express the requirements.
