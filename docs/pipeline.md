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
  population: 'triples',
  sampleLimit: 262144, // null explicitly requests all samples
  footprint: 'point', // 'grid' uses sample-cell dimensions
  backend: 'cpu',     // 'webgl' requests accelerated rasterization with fallback
  space: 'sphere'
};
view.appearance = {
  ...view.effectiveAppearance,
  hue: 'phase',
  lightness: 'entropy',
  opacity: 'tripleCount'
};
```

Preset promotion keeps its point population. Switching a string mapping to an
identity expression no longer turns distinct tuples into repeated byte samples.
Native and general painter edge/color scaling can still differ.

Sampling limits never narrow the selected interval. Exact statistics still use
all selected bytes. A limit bounds mark preparation/sorting, not full FFT arrays,
entropy arrays, or metadata needed to discover distinct tuples. Tuple/bin points
are subsampled in population order. Byte values/entropy can average intervals;
text and Hilbert samples remain representative bytes. Footprint is explicit so
expression spelling cannot change mark size.

## Profiles

```js
const json = JSON.stringify(view.exportProfile());
localStorage.setItem('thea-profile', json);
// In another session, after constructing the view:
view.importProfile(localStorage.getItem('thea-profile'));
```

The host chooses storage and names. `profiles.js` also exports `serializeProfile`
and `parseProfile`. Version 1 includes population, sample policy, geometry,
appearance, definitions, text/compatibility settings, camera, and backend. Source
URLs and selected ranges are session state and excluded. Imports validate before
replacing state. Exported profiles and public settings are owned snapshots.

## Execution boundaries

`histograms.js` shares incremental counts across native/general clients.
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

No automatic profile persistence or profile-library UI is provided. No HTTP Range
reader, streaming input, WebGPU backend, or GPU recipe/provider execution is
implemented. Overview page totals help whole-page contributions; changed ranges
whose pixels require evicted partial pages can still need source reads. Browser
coverage currently exercises Chromium with SwiftShader; physical GPU and other
browser behavior still needs validation.
