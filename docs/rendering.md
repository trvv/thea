# Rendering, scheduling, and performance

## One view pipeline

All view jobs resolve into ordinary point configuration before dispatch. Presets
supply defaults; no preset name selects a painter. `resolveViewJob` also accepts
older low-level callers without configuration: it materializes preset mappings,
converts legacy coordinate systems/axis permutations, and supplies a sample budget.
An explicit configuration is authoritative. Overview bars retain their separate
averaging pipeline because they summarize source intervals rather than draw points.

```text
source window → population + lazy providers → compiled recipes
              → world coordinates / appearance → projection + ordering
              → shared CPU raster or WebGL raster → optional text
```

`RenderEngine` owns a canvas and assigns each immutable Blob an engine-local
`sourceId`. Jobs are owned snapshots. UI and worker execution call the same
`executeRender`; caches belong exclusively to that canvas/thread. Never run
unrelated concurrent jobs against the same mutable cache.

| Job field | Contract |
| --- | --- |
| `source`, `sourceId`, `offset`, `length` | Immutable source, engine-local identity, half-open selected interval. |
| `region` | Preset defaults and legacy `count` interpretation; never a painter selector. |
| `configuration` | Population, sampling, dimensions, coordinate expressions, space, footprint, backend, definitions. |
| `sampleLayout` | Sample budget and aspect hint, independent of output resolution. |
| `columns`, `rows` | Actual output raster dimensions. |
| `appearance`, `shaders` | Scalar/expression mappings and compatibility color/text flags. |
| `rotation`, `pointScale` | Camera and DPR × interaction-quality scale. |
| `coordinateSystem`, `axes` | Compatibility inputs converted to configuration when one is absent. |

## Independent cache boundaries

| Stage | Reuse and invalidation |
| --- | --- |
| Overview summaries | Per-source prefix pages and coarse totals; bounded detailed-page LRU. |
| Selected byte window | Source/selection plus entropy halos; larger halos upgrade the cached read. |
| Histograms | Incremental byte/pair/triple counts over valid tuple starts; all reads are staged before mutation. |
| Spectrum | Exact-selection coefficients; phase and amplitude arrays are lazy. |
| Entropy | One result per requested window size for the selected source interval. |
| Recipe plans | Bounded structural caches; cloned expressions share plans, evaluators own scratch. |
| `pointGeometry` | Source/range, sampling/population, position/space/dimensions/definitions, text sampling. Color, opacity, size, shape, encoding, backend and footprint are excluded. |
| `preparedPoints` | Geometry plus appearance/text settings. Camera and output raster dimensions are excluded. |
| Projection and ordering | Geometry, camera, raster size, space, footprint and point scale. Color/opacity/shape/size changes reuse them; mark size is applied after projection. |
| CPU raster storage | Reused until output dimensions change; pixels are recomposited for each frame. |

Truncation records visible sample ordinals alongside world coordinates. An
appearance-only pass evaluates exactly those samples, including the case where
none are visible. It does not need to evaluate position expressions again.

Geometry/preparation keys are separate from presentation identity. Every setting
that changes output still participates in stale-frame rejection, even when it
can reuse part of the computation.

## Operation-based optimizations

Add optimizations at the stage that owns the work, with eligibility based on
operations or mark properties. Do not branch on preset names or build a second
factor layout.

- Source/constant-only recipe graphs lower directly to output assignments,
  preserving float32 rounding, finite guards, and clamping.
- Appearance mappings with at most two color inputs can use bounded exact
  8-bit color tables. Only exactly representable normalized input values use a
  table; fractional/custom values take the scalar conversion. Tables are bounded
  by the appearance-plan cache and work with any preset or coordinate recipes.
- CPU opaque square interiors use packed row fills. Boundary pixels, circles,
  and translucent marks retain the four-probe coverage and blending rules.
- Geometry, projection and depth order survive changes that cannot affect them.
  Both backends consume the same prepared marks, projected positions and order.

`tests/rasterization.js` compares optimized CPU output against an independent
four-probe reference over fractional positions/sizes, clipping, both shapes,
transparency and ordering. `tests/render-pipeline.js` verifies preset/explicit
configuration equivalence and stage invalidation. Browser tests compare CPU and
WebGL across spaces and shapes and exercise capability/context-loss fallback.

## Timing and benchmarks

View results expose `timings` for preparation, projection, sorting and
rasterization/text, and `reused` for geometry and projection. Frame callbacks
receive these through local and worker execution. Preparation currently includes
provider reads and analysis as well as recipe evaluation; those sub-stages are
not timed separately. End-to-end frame duration also includes worker transport
and presentation. Instrumentation is developer data, with no page status UI.

`bun tests/scroll-benchmark.js` reports cold, warm, appearance-edit, camera and
scroll costs with deterministic fixtures. An optional repository path runs the
same fixtures against an older checkout for an equivalent-configuration comparison.
See [recorded comparisons and limitations](performance.md).
The canvas double excludes browser text compositing, actual ImageBitmap transfer,
and GPU presentation; timings are relative observations, not universal FPS claims.

Removing old painters also removes their separate visual conventions: fixed
256-pixel digraph rasters, peak-scaled tuple gray, pre-aggregation of DFT bins into
pixels, tuple-only wireframes, and separate per-probe depth-owner repair. All
callers now use the configurable point semantics already used by customized and
entropy-shaded tuple/spectrum views. Former very tight byte-grid loops can still
outperform the general pipeline on dense simple input; unification is not a claim
that every former specialized case is already faster.

## Scheduling and presentation

The default UI-thread budget is 8 ms. Structural work estimates use reachable
providers, expression complexity, population, output size, FFT working size and
backend. Calibration/offloading affinity follows space, backend and text mode,
rather than preset names. Once offloaded, a workload stays on its worker to retain
cache locality. Each canvas has one active and one replaceable pending job.

Reject already-presented IDs and frames with incompatible sources/settings/output
sizes. Compatible progressive scrolling and camera-only changes in any 3D space
can present completed intermediate frames so continuous input does not starve the
display. Worker errors retry only the newest request locally. Disconnect terminates
the worker, settles pending work, and disposes local GPU resources.

Supersession is checked after asynchronous reads. Long synchronous loops still run
to completion; cancellation latency remains an avenue for improvement. Histogram
changes are staged before commit so cancellation cannot poison later frames.

## Coverage, acceleration and adaptive quality

The CPU rasterizer is the reference. Three-dimensional points are ordered
back-to-front; four sample probes determine pixel coverage, followed by ordered
alpha blending. This preserves rear contributions at partially covered edges.
WebGL2 uses instanced quads with the same coverage rule. CPU providers, recipes,
projection, sorting and text remain in place. WebGL is opt-in and falls back on
unavailable contexts, viewport limits, errors or context loss.

The adaptive controller belongs to all 3D spaces. Two sustained slow reports can
reduce raster scale; six fast reports permit recovery, and roughly 180 ms idle
restores detail. Scale remains at least 0.25. An ineffective reduction rolls back
and locks for that interaction. Sample budgets, selected bytes, and navigation
strides do not change with raster quality. Perspective size changes continuously
with the same `3.5 - depth` denominator as projection.

## Entropy shading

Every preset defaults to Local Entropy hue with a 32-byte neighborhood.
Points → Hue → Window selects 1–4096 bytes. Editing the shorthand creates a normal
entropy recipe saved in profiles; channels may have independent windows.
One rolling count-table implementation serves both built-in and custom windows.
The built-in 32-byte factor retains its 8-bit quantization. Halo reads extend past
the selection within the source, clipping at file edges. Normalization uses the
requested window's achievable entropy, up to eight bits.

## Remaining performance work

Sampling bounds prepared marks, not full-window provider storage or tuple discovery.
Sparse byte/entropy paging, incremental tuple representative discovery, finer
provider timings, dependency-specific color/size buffers, generic dirty-region
raster updates, and GPU projection remain useful next steps. Restore no removed
shortcut without making its applicability and numerical/coverage contracts explicit.

FFT working buffers can exceed input size, especially for Bluestein lengths;
the spectrum cache copies only one-sided coefficients so padded buffers can be
released. Triple maps can approach one key per tuple. Overview detailed pages are
bounded to 64 × 65,536-byte prefix arrays per bar (roughly 16 MiB), with coarse
page totals retained separately. Multiple bars/workers still duplicate caches.
