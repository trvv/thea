# Sequential implementation plan

This is the combined implementation order for the ideas in this folder. It
supersedes the ordering in the older roadmap and next-steps proposals. It is a
backlog with useful stopping points, not a commitment to build every extension
in one pass. Update the status and evidence here as increments land.

Current user scope: complete the browser app for fixed-file exploration. External
Ghidra/IDA adapters and live-input transports are outside the critical path;
ordinary navigation events can support an adapter later. Device validation must
report available environments rather than claim unperformed hardware tests.

The inputs are the [analysis implementation review](analysis-implementation.md),
the [infrastructure review](infrastructure-implementation.md), and the
[CantorDust comparison](cantordust-comparison.md). Those reviews explain the
algorithms and file-level integration in more detail.

## Constraints that apply throughout

- Population chooses marks; it does not restrict analysis. Byte, tuple, spectral,
  text and numeric interpretations remain mixable through explicit addresses.
- Presets produce ordinary configuration. Coordinate curves are expressions;
  there is no global Layout or preset-specific rendering dispatch to restore.
- Preserve exact raw values, units, validity and source spans before display
  normalization. Missing input is different from a measured zero.
- Prepare only reachable work, share identical requests, and keep provenance
  on demand. Do not allocate explanatory objects for every mark.
- Keep the current CPU implementation as the reference. An optimization must
  preserve boundaries, quantization, sampling and coverage, or be an explicitly
  different analysis/rendering option.
- Use native Blob, DataView and serializable expression objects. Extract shared
  machinery for demonstrated reuse rather than building a registry or scheduler
  ahead of its users. Keep performance reporting out of the page.

## Implementation order

The Progress section records delivered slices. Named localStorage preset management,
explicit dimensions, 3D Hilbert, mixed providers and the general renderer are
already implemented and are not work to repeat.

| Step | Deliverable                                      | Prerequisites and bounded first result                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Provider diagnostics                             | Separate reads, entropy, histograms, FFT and recipe visits; count retained buffers once. Explicit recipe providers already participate in routing estimates; use measurements before refining those estimates. Report cold/warm behavior without timing assertions.   |
| 2    | Reusable current-recipe experiments              | Pure parameterized factories for byte differences, delayed coordinates and entropy contrast in bits. Deterministic fixtures and validated profile examples; preserve population and unrelated traits.                                                                 |
| 3    | Compact byte bit operations                      | Byte-width XOR, extraction and population count through validation, CPU, menus, emitted shaders and inspection. Hamming change composes these with explicit reads and normalization.                                                                                  |
| 4    | Bounded UTF-8 point inspection                   | Strict scalar decoding around the actual addressed byte, including continuation-byte clicks and root context outside selection. Keep averaged samples and bin correspondence explicit.                                                                                |
| 5    | Sparse byte/entropy preparation                  | Use step 1 reports; start predictable representative lookups, merged pages and halos. Dense fallback for data-dependent addresses and exact averaged buckets. Preserve 32-byte entropy quantization.                                                                  |
| 6    | Bounded scans, cancellation and provider budgets | Stream exact counts and tuple discovery; estimate FFT storage before allocation. Yield only with atomic cache publication. Never silently shorten a transform/history.                                                                                                |
| 7    | Shared immutable overview summaries              | Deduplicate concurrent reads by Blob within one context, with one cache budget and failed-read retry. Document remaining cross-worker duplication.                                                                                                                    |
| 8    | Validity, complete-span and numeric reads        | Add explicit complete-span availability without changing legacy byte zero-fill. Start uint16/int16, then exact uint32/int32 and float32 classification, both byte orders and unaligned addresses. Normalize before losing precision.                                  |
| 9    | Byte-frequency population and table              | Reuse exact raw byte counts; decide all-256 versus observed values explicitly. Preserve zero-count validity and occurrence relationships; build a configuration rather than a new painter.                                                                            |
| 10   | Packed-pixel interpretations                     | Build on bits and numeric spans: explicit packing, byte order, stride/origin and channel projections. Define faithful RGB/alpha output beyond current HSL mappings; start a small RGB/RGBA set; keep alpha and incomplete-pixel policy inspectable.                   |
| 11   | Morton coordinates, then evaluate H-curve        | Exact index-to-vector operations and scalar projections, shared CPU/shader parity. Add configuration examples; retain Hilbert and independent source order. H-curve waits for a complete algorithm/adjacency contract.                                                |
| 12   | Tuple representatives and occurrence navigation  | Preserve tuple enumeration while adding first/last relationship. Bounded occurrence pages and source hex context can navigate concrete matches without retaining every address.                                                                                       |
| 13   | Atomic factor editing and profile transactions   | Rename references atomically; reject deletion of referenced definitions. Bounded undo/redo, compact validated expression editing, then optional preset file transfer and separately defined bookmarks.                                                                |
| 14   | Selected-window conditional surprise             | One first-order smoothed transition model with probability, raw surprise and validity. Reuse raw pair counts; expose in-sample training scope.                                                                                                                        |
| 15   | Lag comparison and dependence                    | One lag, equality/difference and valid pair counts first; mutual information next with zero-entropy policy. Automatic lag search is a separately bounded extension.                                                                                                   |
| 16   | Distribution change                              | Total variation of two explicit windows first; independently normalized clipped ranges and validity. Jensen–Shannon divergence later under a distinct metric.                                                                                                         |
| 17   | Rolling bit bias and entropy                     | Shared counters for requested windows; distinguish constant-zero and constant-one bias from their equal zero entropy. Compare sparse/dense implementations.                                                                                                           |
| 18   | Bounded exact repetition matching                | Nearest previous fixed-width block, history and overlap policy; exact addresses and verified bytes. Candidate extension before global longest-match or approximate indexes.                                                                                           |
| 19   | Local spectral energy                            | Explicit frame/hop/origin/window/detrending/edges/DC policy; deduplicated bounded frames, band-energy and validity. Direct-DFT reference; spectrogram population follows separately.                                                                                  |
| 20   | Wider text and numeric interpretations           | UTF-16/32 candidates with alignment/origin, then bounded grapheme context and optional encoding factors. Float64/int64 require a raw precision/serialization decision first.                                                                                          |
| 21   | Occurrence reductions and interpolation          | One actual reduction such as mean entropy over occurrences, never entropy at an average address. Explicit spectral interpolation policy; budget extra scans/indexes.                                                                                                  |
| 22   | Raw-count exposure and density                   | Explicit log/reference/exposure mappings first, with fixed or population-percentile reference independent of rendered sampling. Optional generic screen accumulation later; define weights, coverage and aggregate inspection separately from selection-space counts. |
| 23   | Linked concurrent views                          | Shared source and selection owner with independent profiles/cameras. Explicit link groups avoid event loops; use shared summaries where ownership permits. Start embedded views before detached windows.                                                              |
| 24   | Host addresses and semantic overlays             | A transport-neutral file-offset/address mapping and navigation events first. Optional Ghidra bridge and imported annotations follow, with explicit unmapped spans and source identity.                                                                                |
| 25   | Template n-gram scoring                          | Versioned model artifacts, feature extraction/preprocessing, score and uncertainty contracts, budgets and held-out fixtures. Show comparative scores before claiming probabilities or automatic format identification.                                                |
| 26   | Generic execution improvements                   | From measurements: dependency-specific appearance buffers, then a property-selected fused grid kernel; persistent GPU buffers and camera work only where parity and end-to-end gains hold.                                                                            |
| 27   | Source/device extensions                         | CPU browser matrix first; physical GPU evidence before accelerated defaults. HTTP Range/live sources require version/cancellation/offset contracts; WebGPU compute, worker pools and record populations remain independent workload-driven branches.                  |

The table is sequential for delivery and review. Independent small work can be
developed in parallel inside a step; later steps need not block earlier useful
results. Revisit priorities when diagnostics or user feedback identify a more
valuable next increment. In particular, statistical and linked-view features do
not depend on GPU execution.

## First implementation batch

Implement steps 1–4 as separate reviewable slices. This adds useful analysis and
inspection while establishing evidence for the first large-source optimization.
It deliberately stops before new statistical tables, source protocols or GPU
execution. Step 2 can start with importable factories and examples rather than
adding a submenu full of nearly identical presets.

For bit operations use a documented byte conversion shared by CPU/shaders; a
normalized byte factor must be converted to raw byte units explicitly. For UTF-8,
show code points and exact spans, without claiming an entire grapheme or a
file-wide encoding. No schema change is required for inspection-only metadata.

## Acceptance gates

Each delivered slice needs numerical reference fixtures, boundary/validity and
unused-provider checks, source/cache freshness, serialization where applicable,
and on-demand source explanation. Extend worker and browser checks for controls,
presentation or inspection changes. Do not use platform-dependent timing gates.

For performance work, report cold/warm costs, bytes read, cache reuse, retained
typed buffers and the limits of the accounting. Default averaged samples may
require all bytes in a bucket; fetching only a representative changes the
analysis. Opaque point colors still have fractional edge coverage, so ordinary
depth-tested quads cannot be assumed equivalent to the current blend order.

## Progress

- Planning: combined order written; source-specific CantorDust evidence remains
  in its comparison documents rather than being treated as Thea implementation.
- **Step 1 delivered:** opt-in provider diagnostics through local/worker frame
  results, a deterministic benchmark, exact read counts, coarse provider/visitor
  timings and deduplicated backing-buffer accounting. See
  [measurement contracts and results](../performance.md#provider-diagnostics).
  Engine lifecycle counters, enqueue latency and transient peak memory remain
  later instrumentation increments; no claim of complete memory accounting.
- **Step 2 delivered:** `recipe-experiments.js` factories for byte differences,
  delayed coordinates and bit-scaled entropy contrast. See
  [API examples](../recipe-experiments.md). These are importable recipe factories;
  no additional menu presets or parameterized-editor UI were added.
- **Step 3 delivered:** `bit`, `xor` and `popcount` operations, menu transforms,
  CPU evaluation and GLSL/WGSL emission. Exhaustive byte/pair fixtures and
  executed GLSL graphs cover conversion and composition. WGSL still has no real
  device execution evidence.
- **Step 4 delivered:** strict bounded UTF-8 decoding at the inspected origin,
  including continuation bytes, cross-selection context, escaped controls,
  representative/tuple/bin relationships and stale reads. See
  [inspection behavior](../inspection.md). Other recipe lookup addresses and wider
  encodings remain later work.

The complete 27-suite Bun regression run passes, including four new suites;
16 generated GLSL graphs compile, link and match CPU results in GLES. Real
Chromium checks cover local/worker UTF-8 popups alongside existing rendering,
inspection, presets and navigation. Formatting and local documentation links
are checked. Browser/GPU claims retain the environment limits documented in
[development](../development.md).

- **Step 5 delivered:** [sparse preparation](../sparse-providers.md), merged exact
  root ranges, entropy quantization, on-demand provenance accessors, dense
  fallbacks and allocation estimates. The 1 MiB/256-mark case retains 8,176
  source bytes rather than 6,291,456 provider typed bytes; 256 small reads and
  Map/object overhead remain. Averaged buckets keep their dense reference.
- **Step 6 delivered first boundary:** [streaming scans](../bounded-scans.md),
  atomic histogram deltas, real task yields, cooperative worker cancellation and
  configurable operation-level budgets, including FFT workspace estimates.
  Exact distinct result storage remains data-dependent; long FFT butterflies
  are still synchronous and are not claimed to be interruptible mid-transform.
- **Step 7 delivered:** [overview sharing](../overview-sharing.md), concurrent
  read deduplication, retry and bounded immutable per-source caches. Workers
  still own separate execution contexts; no process-wide shared cache claim.
- **Step 8 delivered:** complete-span availability and native integer/float32
  interpretations, byte order, explicit normalization before f32 conversion,
  float classifications, raw inspection and provider shader interfaces. See
  [recipes](../recipes.md). Numeric reads initially use dense byte preparation.
- **Step 11 delivered Morton:** exact 2D/3D interleaving vectors, shared scalar
  projections, menus and CPU/executed GLSL parity. H-curve remains a separately
  evaluated extension requiring a defined traversal contract.
- **Steps 12–13 foundations delivered:** first/last representative addresses keep
  population order stable. Atomic factor rename/delete, bounded menu-edit
  undo/redo and validated profile JSON editing are documented in
  [profile editing](../profile-editing.md). Occurrence browsing, file transfer
  and bookmarks are still pending.

The second batch passes 34 Bun suites and 22 executed GLSL graphs, plus Chromium
integration checks. Next work: byte-frequency population/table, packed pixels,
occurrence navigation and the selected statistical-provider families. Remaining
steps are still active; a documented proposal is not an implementation.

## Browser delivery audit

This records the bounded delivery in each remaining row, rather than silently
promoting optional research branches into implemented features.

| Steps | Delivered browser behavior                                                        | Evidence and limits                                                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9     | Observed byte-symbol population and editable frequency table under Load           | Exact counts, first/last, 00/FF retained; no fabricated absent-symbol addresses. `byte-frequency`.                                                                                                            |
| 10    | RGB appearance, eight packed formats and complete strided records                 | Exact channels/alpha, endian/stride/origin/completeness and popup provenance; `packed-pixels` and Chromium.                                                                                                   |
| 11    | 2D/3D Morton                                                                      | Executed CPU/shader parity. H-curve evaluated as a later experiment: the upstream class alone does not supply an independent orientation/inverse contract. Retain that gate.                                  |
| 12    | Bounded next/previous/wrapped occurrence search and hex context                   | Exact tuple/symbol/record patterns, no full index, freshness checks, no fake bin occurrence. `occurrences`.                                                                                                   |
| 13    | Atomic factors, per-pane history, JSON editing/file transfer and bookmarks        | Validated storage, source matching and exact restored intervals. `profile-edits`, `bookmarks`, component tests.                                                                                               |
| 14–17 | Conditional surprise; lag equality/difference/MI; TV/JS; rolling bit bias/entropy | Selected scopes, raw units, validity, rolling/shared models, direct oracles and provenance. `analysis-providers`.                                                                                             |
| 18    | Exact nearest fixed-width repetition and chosen-candidate extension               | History/overlap/expiration, budgets/cancellation and real spans; `repetition`. Not a global longest-match search.                                                                                             |
| 19    | Local spectral energy                                                             | Explicit frames, tapers, preprocessing, edges, DC/bands; deduplicated reductions and direct DFT/Parseval references. `local-spectrum`.                                                                        |
| 20    | UTF-16/32, bounded graphemes, encoding factors, float64/int64                     | Exact BigInt strings/bounds before normalization; scalar validity/spans. `byte-interpretation`, `grapheme-inspection`, `encoding-analysis`, `numeric64-recipes`.                                              |
| 21    | All-occurrence entropy reduction and complex spectral interpolation               | Streaming per-key sums/counts, explicit selected entropy, phase-safe blend and endpoint weights. `occurrence-reductions`, `spectrum-sampling`.                                                                |
| 22    | Raw counts/probabilities and fixed/percentile exposure                            | Sampling-independent references, zero-category policy and pre-f32 normalization. `occurrence-analysis`. Screen accumulation remains explicitly optional because it changes contributor/compositing semantics. |
| 23    | One linked comparison pane                                                        | Shared source/range, independent profile/camera/history, active-pane menus and cleanup; component/Chromium. Worker analysis caches remain separately owned.                                                   |
| 24    | Source address/annotation contract and cancellable event                          | Wide addresses, overlapping spaces, half-open spans and replacement. External host transport is outside the clarified scope.                                                                                  |
| 25    | User-trained byte/pair reference artifacts and resemblance                        | No bundled corpus; IDs in recipes, bounded artifact storage, evidence/margin/uncertainty, held-out fixtures, provenance and real worker tests.                                                                |
| 26    | Dependency-based color reuse and persistent WebGL uploads                         | Buffer/counter assertions and exact reference pixels. GPU projection/compute and a fused grid kernel remain measured alternatives rather than preset painters.                                                |
| 27    | Native File opening and explicit device matrix                                    | CPU remains default; Chromium/SwiftShader and GLES evidence recorded. Firefox/Safari/physical GPUs untested here. Range/live/external adapters are outside fixed-file focus.                                  |

Current behavior: [statistics](../statistical-analyses.md),
[nonlocal analyses](../nonlocal-analyses.md), [packed pixels](../packed-pixels.md),
[text](../text-interpretations.md), [references](../reference-models.md),
[comparison](../comparison-views.md), [source navigation](../source-navigation.md)
and [device evidence](../device-matrix.md).

### Original gates retained

H-curve needs an agreed independent contract; screen-space accumulation needs a
compositing/contributor model; GPU projection/compute needs end-to-end benefit
and real-device evidence. Automatic lag search, record parsers, global longest
matches, spectral populations and workspace persistence are further extensions,
not hidden changes to the delivered measurements. These remain identified as
such rather than being described as done. The browser milestones are usable
without those branches.
