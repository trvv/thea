# Direction and open decisions

## The organizing idea

Thea began with byte streams, buffers, maps, and views as a general visualization
vocabulary. The working application is narrower: a seekable Blob, selected byte
windows, independent coordinate/appearance factors, and CPU rendering. The
interesting direction is to make that concrete implementation more composable
without losing the immediacy of exploring a binary.

The long-term model is:

```text
Source / selected window
  → required providers
  → shared typed expressions
  → positional and appearance channels
  → a renderer backend
```

A preset should become a profile over that model rather than a separate island
of feature-specific controls. A byte-neighbor recipe, entropy calculation, or
Hilbert coordinate should be usable wherever its output type fits. A space
supplies positional channels; it should not dictate the source of every point's
color or opacity.

## Implemented foundations

- Independent spaces and position/appearance mappings.
- A universal primitive factor pool and demand-driven providers.
- Serializable scalar/vec2 expressions with named scalar definitions.
- Shared typed DAGs and compiled CPU instructions.
- Explicit byte-offset and spectrum-sampling operations.
- Worker rendering, bounded request backlog, incremental native caches, and
  measured interaction-quality feedback.
- GLSL/WGSL function-library emission from the same expression graph.

These foundations are present, but the native preset implementations and raw
point pipeline still coexist. Profiles are not persisted and GPU drawing is not
connected.

## Next useful work

### Make profiles durable

Saving, duplicating, editing, exporting, and importing complete visualization
profiles should include geometry, mappings, named definitions, text settings, and
relevant camera/default settings. A versioned schema is needed before the current
expression objects become a long-lived file format. Selection ranges/source URLs
may belong to a separate session/bookmark concept rather than every reusable
profile. That boundary is not settled.

### Connect a GPU backend

A first backend can keep the existing CPU/worker providers, upload their results,
and run point expressions, projection, color conversion, and mark rendering on the
GPU. It needs explicit storage bindings, limits, lifecycle/device-loss handling,
blending behavior, and browser capability fallback. WebGPU compute can eventually
replace expensive providers, but moving FFT/entropy/histograms is a separate task
from drawing particles efficiently.

GLSL execution fixtures establish a useful numerical baseline. WGSL still needs
actual device validation. Color-space, alpha, coverage/depth, and float precision
must remain explicit so GPU speed does not hide a different data interpretation.
Integer byte-address types or paging are needed for exact large-offset recipes.

### Make the two sample domains explicit

Optimized Digraph/Trigraph aggregate tuples; general points are sampled byte
offsets. Native DFT aggregates bins into output pixels, while general spectral
factors attach sampled coefficients to points. A future common pipeline should
represent aggregation, traversal, and resampling as explicit stages, rather than
silently inferring them from a preset name or changing semantics when a menu is
edited.

This also creates room for additional inputs: true frequency-bin points,
localized/windowed spectra, structured records, or higher-dimensional locality
curves. None of those are current capabilities.

### Improve the recipe editor without multiplying enums

The menu editor is an initial representation of the expression model. Named
recipes can reduce repeated configuration, but deeply nested operations are still
awkward to edit. A compact expression editor, reusable parameterized recipes, or
a graph UI could help. A textual DSL is an option, not a required new parser or
permission to embed JavaScript. Preserve inspectability and type validation.

### Broaden data access deliberately

Blob slicing is enough for the present viewer. HTTP Range sources, streamed or
live buffers, bounded page caches, and format-aware decoding would need a real
source/provider contract, cancellation policy, and offset model. Reintroducing a
wrapper that only renames Blob methods would not solve those needs. Text overlays
are currently single-byte glyph choices, not Unicode decoding with byte-range
tracking.

## Questions to answer before committing to designs

- Which stages operate on byte samples, records, aggregated tuples, or spectrum
  bins, and where is resampling explicit?
- Which vector/index types are needed beyond scalar f32 and vec2?
- What numerical differences are acceptable between CPU and GPU backends?
- How should users inspect a recipe's sampling and aggregation without filling
  the page with explanatory chrome?
- Which configuration belongs in a reusable profile versus a source-specific
  session/bookmark?
- Which optimized caches can become general provider implementations while
  retaining their cancellation and incremental-update guarantees?

These are design directions, not a promise that every item will be implemented.
The core preference remains a small, understandable system whose abstractions
explain the work it actually performs.
