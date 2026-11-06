# Pipeline contracts

A visualization has a point population and independently selected analyses:

```text
selected Blob window → point population → mixed providers/recipes → space/appearance
                                                               → CPU or WebGL raster
```

Population is not an exclusive analysis domain. `bytes`, `pairs`, `triples`, and
`bins` determine which points exist. Every population may use byte neighbors,
entropy, occurrence statistics, spectral factors, or expressions combining them.
Providers keep their own sampling/scope contracts. Tuple points use their first
selected occurrence as their byte address; bin points use their exact spectral
bin and a proportional byte address. Explicit spectrum expressions retain their
own normalized lookup input.

## Configuration

```js
view.pointConfiguration = {
  ...view.pointConfiguration,
  population: "triples",
  position: ["value", "byte2", "byte3"],
  sampleLimit: 262144, // null explicitly requests all samples
  footprint: "point", // 'grid' uses placement-cell dimensions, including perspective in 3D
  backend: "cpu", // 'webgl' requests accelerated rasterization with fallback
  space: "sphere",
};
view.appearance = {
  ...view.effectiveAppearance,
  hue: "phase",
  lightness: "entropy",
  opacity: "tripleCount",
};
```

All presets and custom configurations use one pipeline. Switching a string
mapping to an identity expression keeps the same population and coverage rules.

Sampling limits never narrow the selected interval. Exact statistics still use
all selected bytes. A limit bounds mark preparation/sorting, not full FFT arrays,
entropy arrays, or metadata needed to discover distinct tuples. Tuple/bin points
are subsampled in population order. Byte values/entropy can average intervals;
text and the representative sampling policy use actual bytes. Footprint is explicit so
expression spelling cannot change mark size.

## Dimensions

There is no Layout selector. Position recipes directly supply each coordinate;
per-axis ranges, Scale/Truncate, and Fit control its domain and presentation.
Width/Height/Depth or the space's radial channel names each expose Start/End/Step,
Range Mode, Fit, and Reset Range. Every dimension defaults to Scale and Fit on.
See [dimensions](dimensions.md) for semantics, cell counts, and configuration.

## Explicit 3D Hilbert traversal

`hilbert3DCoordinate(axis)` supplies X/Y/Z projections from an exact Point Index.
The default automatic order follows the full population count; the sample limit
only chooses which indices are evaluated. A `hilbert3d` expression returns a shared
vec3 and can feed any compatible scalar channel. It is independent of other position mappings and the chosen display space. See [recipes](recipes.md#three-dimensional-hilbert-coordinates)
for normalized versus integer inputs, order limits, and a complete configuration.

## Profiles

```js
const json = JSON.stringify(view.exportProfile());
localStorage.setItem("thea-profile", json);
// In another session, after constructing the view:
view.importProfile(localStorage.getItem("thea-profile"));
```

The Preset menu provides a named localStorage library, JSON copying/import, and
restoration of the last selected preset. Saved snapshots also include bar count.
See [saved presets](presets.md). `profiles.js` separately exports `serializeProfile`
and `parseProfile` for host-managed raw view profiles. Version 3 includes dimension ranges/flags, population, sample
policy, geometry, appearance, definitions, text/compatibility settings, camera, and backend. Source
URLs and selected ranges are session state and excluded. Imports validate before
replacing state. Versions 1 and 2 are migrated: former arrangements become
explicit position recipes and grid counts become ranges. Exported profiles and
public settings are owned snapshots. Migration preserves intent, with legacy
raster differences documented in [dimensions](dimensions.md#hilbert-and-profiles).

## Execution boundaries

`histograms.js` provides incremental counts for all configurations.
`spectrum.js` shares selection-scoped coefficients and lazy phase/amplitude arrays.
Cancellation is checked after awaited reads and before histogram mutation.
`render-identity.js` centralizes setting identity; camera/raster changes retain
prepared points, while population/sample/provider changes invalidate them.

CPU recipe indices preserve safe-integer addressing. Visual arithmetic retains
float32 rounding. Emitted shader-library index inputs use signed 32-bit integers;
callers must enforce the narrower range. The WebGL rasterizer consumes prepared
CPU results and therefore does not inherit that shader-library address limit.

The WebGL backend draws instanced quads with four coverage probes and ordered
alpha blending. CPU preparation, projection, sorting, and text remain in place.
It is opt-in because startup/upload costs and device performance vary. Unsupported
contexts, viewport limits, errors, and context loss fall back to CPU. Disconnect
releases local GL resources or terminates the owning worker.

## Remaining boundaries

No HTTP Range reader, streaming input, WebGPU backend, or GPU recipe/provider execution is
implemented. Overview page totals help whole-page contributions; changed ranges
whose pixels require evicted partial pages can still need source reads. Browser
coverage currently exercises Chromium with SwiftShader; physical GPU and other
browser behavior still needs validation.
