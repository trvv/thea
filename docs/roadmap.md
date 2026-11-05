# Direction and open decisions

The working model is a seekable Blob, selected byte windows, independent analyses,
serializable recipes, and interchangeable point rasterizers. Keep abstractions
focused on those concrete responsibilities.

## Implemented foundations

- Point populations independent of mixed analysis providers.
- Explicit mapped/linear/Hilbert arrangements in 2D/3D, grid strides and Slice,
  sampling policies/limits, footprints, and CPU/WebGL backend choice.
- Serializable scalar/index/vector expressions with shared typed DAGs, including
  explicit 2D/3D Hilbert coordinates and exact population ordinals.
- Lazy providers, incremental byte/pair/triple counts, and shared spectrum caches.
- Bounded worker queues, compatible frame presentation, and adaptive raster quality.
- Versioned JSON profile import/export with atomic validation.
- Optional WebGL2 rasterization, four-probe coverage, and CPU context-loss fallback.
- GLSL/WGSL recipe-function emission, with executed GLSL integer-address fixtures.
- Real Chromium integration checks in addition to numerical/canvas-double tests.

## Next useful work

See [detailed next steps](next-steps.md) for suggested sequencing, implementation
options, tradeoffs, and completion criteria.

### Move more execution to the GPU when measurements justify it

The rasterizer currently uploads projected marks; providers, expressions, camera
projection, sorting, and text remain on CPU. GPU expression/projection execution
can consume the existing IR, but still needs storage bindings and explicit
precision/limit contracts. Moving FFT/entropy/histograms to compute is a separate
step. WebGPU and emitted WGSL still need real device validation.

### Improve source-scale memory and preparation

Sampling bounds point storage, not exact FFT/entropy arrays or distinct-tuple
metadata. Large inputs need provider-specific paging/budgets. Overview coarse page
totals avoid rebuilding full-page contributions, but changing ranges with evicted
partial-page detail can still require reads. Sharing immutable source summaries
across bars would reduce duplicate work without sharing mutable renderer caches.

### Build profile management on the versioned format

The application exposes JSON import/export without automatically choosing storage
or adding a profile library. Named storage, duplication, import/export controls,
and migrations can use the existing schema. Source-specific selection/bookmark
state should stay separate from reusable visualization settings.

### Keep populations and provider relationships composable

Structured records, localized spectra, alternative tuple representative policies,
interpolation, and additional vectors can extend the model. They must not turn
population into an exclusive analysis domain. Preserve the ability to color tuple
points with spectrum/entropy analyses or mix spectral factors on byte points.

### Broaden data access deliberately

Blob slicing remains sufficient for local immutable sources. HTTP Range, live
buffers, bounded source pages, and format-aware decoding need actual contracts
for cancellation, cache ownership, and offsets. A wrapper that only renames Blob
methods would add complexity without those capabilities.

### Improve expression editing when needed

Nested menus are functional but cumbersome for deep graphs. A compact expression
editor or reusable parameterized recipes could help. Keep validation and the data
format independent of the editor; a new textual DSL or graph framework is not a
prerequisite.
