# Remaining proposed work

This is a consolidated index of extensions that have not been delivered, rather
than another implementation plan. Earlier proposal documents retain historical
text; their current-delivery notes and this index distinguish extensions from
implemented browser features. Updated during the performance follow-up.

## Performance

See [the active performance checklist](PERFORMANCE-PLAN.md) for current delivery.
Original proposals: [next steps](next-steps.md),
[infrastructure review](infrastructure-implementation.md), and [PLAN](PLAN.md).

The current performance pass delivered low-cardinality tuple representative reuse,
sparse range reuse across expression edits, FFT cancellation, shared immutable
worker analysis, smaller density buffers, engine/memory diagnostics and optional
WebGL recipe/projection execution. Histograms were already incremental. Density
integer accumulation and rank selection were implementation-driven refinements;
the original proposal did not prescribe those algorithms.

Remaining performance extensions include broader incremental statistical models,
GPU execution of numeric/statistical providers and transforms, WebGPU, dirty-region
raster execution, and physical-device characterization. Exact process-wide peak
memory remains outside what the app's buffer inventory can observe. The current
GPU backend has documented eligibility and CPU fallback, rather than claiming
that every graph now runs on GPU.

Fused regular-grid execution remains proposed but is explicitly excluded from
the current user-authorized pass. The exact radix sort, overlapping source/entropy
pages and opt-in adaptive resolution were delivered before this pass.
See [measured behavior](../performance.md) and [GPU boundaries](../gpu-execution.md).

## Analysis and interpretation

| Remaining proposal                                                                            | Original discussion                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Automatic lag searches                                                                        | [Lag dependence](lag-dependence.md)                                                   |
| Preceding-window/sliding conditional models and higher-order contexts                         | [Conditional surprise](conditional-surprise.md)                                       |
| Global longest matches and approximate repetition indexes                                     | [Repetition distance](repetition-distance.md)                                         |
| Time/frequency population for spectrograms                                                    | [Localized spectral energy](localized-spectral-energy.md)                             |
| Distinct delayed-tuple populations                                                            | [Lagged coordinate plots](lagged-coordinate-plots.md)                                 |
| More reductions over actual occurrences beyond entropy                                        | [Sampling relationships](next-steps.md#5-make-sampling-relationships-more-expressive) |
| Structured-record decoding, beyond current complete strided records                           | [Deferred work](next-steps.md#work-to-defer-until-a-concrete-need-appears)            |
| Palette, planar, tiled and premultiplied image interpretations                                | [Bitmap interpretations](cantordust-bitmap-interpretations.md)                        |
| Bundled reproducible reference models, richer n-grams and validated classification confidence | [Content resemblance](cantordust-content-classification.md)                           |

Byte/pair user-trained reference models, local spectral factors, exact bounded
repetition, UTF-8/16/32 and grapheme inspection, numeric64 interpretations, TV/JS,
rolling bit statistics, H-curve/Morton/Hilbert and screen density are implemented;
they are not outstanding merely because an older design paragraph uses future tense.

## Views, navigation and editing

- Multiple comparison panes, configurable link groups, detached windows,
  cross-highlighting and whole-workspace persistence:
  [linked views](cantordust-linked-views.md).
- Full occurrence lists beyond bounded next/previous navigation:
  [occurrence navigation](cantordust-occurrence-navigation.md).
- A structured expression editor or graph UI beyond the current nested menus and
  validated JSON: [editing direction](roadmap.md#improve-expression-editing-when-needed).

The current app already has one comparison pane, shared selection, independent
profiles/cameras/history, bookmarks, preset storage/file transfer and atomic
factor edits. Workspaces would save the arrangement and links as well as profiles.

## Integration and device coverage

- Ghidra/IDA host adapters: [navigation](cantordust-occurrence-navigation.md).
- HTTP Range and live sources, generalized worker pools and WebGPU:
  [infrastructure extensions](infrastructure-implementation.md).
- Firefox, Safari, physical-GPU and WGSL-device validation:
  [browser/device coverage](next-steps.md#7-validate-more-browserdevice-combinations).

External adapters and live/Range transport remain outside the user's fixed-file
browser focus. Missing hardware/browser evidence is a validation limitation, not
an assertion that supported fallback behavior is broken.
