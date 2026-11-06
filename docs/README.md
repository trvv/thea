# Thea

Thea is a browser-based binary visualizer. It makes byte patterns visible without
requiring a file-format parser: structured regions, repetition, strings, changing
entropy, byte-pair/triple distributions, and frequency content can produce useful
visual patterns even when the data's meaning is unknown.

It is a small vanilla JavaScript application: native custom elements, Canvas 2D,
ES modules, and optional worker rendering. There is no package manifest, bundler,
framework, or backend service. CPU rendering is the default. General points also
have an opt-in WebGL2 rasterizer with CPU fallback. GLSL/WGSL recipe-function
generators remain separate from that rasterizer; providers and recipes run on CPU.

## Run it

From the repository root:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/#examples/cat`, or place another sample under the served
root and name its URL in the fragment. With no fragment, the default is
`./examples/cat`. `examples/` is ignored by Git; a fresh clone may not contain that
file. A missing sample produces a console error, not an in-page error panel.
ES modules and worker URLs need an HTTP server rather than a `file://` page.

The fragment is a URL resolved against `document.baseURI`, not permission to read
an arbitrary host filesystem path. Remote URLs still need the server to allow the
browser's cross-origin fetch. The loader fetches a complete Blob before display;
there is no HTTP Range reader or incremental streaming source today.

## What is implemented

| Area               | Current behavior                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection          | A full-screen view with two nested overview bars by default (configurable under Advanced → Bars); yellow selectors identify each child scope.                                                                                                      |
| Navigation         | Wheel and keyboard movement, draggable selector edges, middle-button velocity scrolling/resizing, and 3D rotation.                                                                                                                                 |
| Presets            | Linear, Hilbert, Hilbert 3D, Digraph, DFT, and Trigraph. All supply ordinary configuration to one shared CPU/WebGL pipeline.                                                                                                                       |
| Dimensions         | Per-axis ranges/step, Scale or Truncate, and independent Fit; defaults are Scale and Fit on.                                                                                                                                                       |
| Spaces             | Square, circle, cube, cylinder, sphere; scalar factors map to their positional channels.                                                                                                                                                           |
| Inspection         | Left-click point provenance grouped by position, shading and text traits; supports mixed analyses and worker rendering.                                                                                                                            |
| Point appearance   | Hue, saturation, lightness, opacity, size, and square/circle marks. Character or hex overlays are optional.                                                                                                                                        |
| Factor recipes     | Explicit 2D/3D Hilbert coordinates, exact population indices, primitive sources, arithmetic, byte bit/XOR/popcount operations, byte lookup, local entropy, spectrum sampling, coordinate vectors, named scalar factors, and shared subexpressions. |
| Scheduling         | Predicted expensive jobs use a worker when supported; ordered presentation and adaptive 3D quality preserve interaction.                                                                                                                           |
| Point population   | Byte samples, distinct pairs/triples, or spectrum bins; independent analysis factors remain mixable.                                                                                                                                               |
| Sampling           | General points default to at most 262,144 samples; selection ranges and exact statistical providers stay independent.                                                                                                                              |
| Shader preparation | The typed recipe graph emits GLSL and WGSL function libraries with explicit provider interfaces.                                                                                                                                                   |

Named presets can be saved, loaded, updated, duplicated, renamed, deleted and
copied/imported as JSON through the Preset context menu. They persist in
localStorage, and the last selected preset is restored on refresh. Built-ins live
under Preset → Load; saved entries load under Load → Saved and are managed under
Manage. See [saved presets](presets.md) for snapshot contents and storage behavior.

The lower-level `view.exportProfile()` / `view.importProfile(profileOrJSON)` API
still handles version 3 view profiles and migrates versions 1 and 2. Preset
snapshots add bar count without persisting source files or selected byte ranges.

Further implemented tools include [byte-frequency tables](byte-frequency.md),
[packed RGB pixels and strided records](packed-pixels.md),
[scoped statistical factors](statistical-analyses.md),
[repetition and local spectra](nonlocal-analyses.md),
[wide numeric and text interpretations](text-interpretations.md),
[reference resemblance](reference-models.md), [screen density](density.md), and an optional
[comparison pane](comparison-views.md). Native files, bookmarks and annotations
are described in [source navigation](source-navigation.md).

Advanced → Open File loads a native File without storing its bytes. Statistical
factors remain freely mixable with positions and other analyses. RGB is an
appearance choice, not a dedicated painter. See [device evidence](device-matrix.md)
for actual acceleration/browser coverage.

## Read next

- [Architecture and source map](architecture.md): ownership, element APIs,
  configuration boundaries, events, and a configuration example.
- [Dimensions and coordinate mappings](dimensions.md): ranges, cells, Scale/Truncate,
  Fit, natural domains, and explicit Hilbert presets.
- [Selection and sampling](data-selection.md): coordinate systems for offsets,
  nested scopes, selection anchors, and what a rendered sample represents.
- [Saved presets](presets.md): local library actions, refresh restoration, JSON transfer, and storage contracts.
- [Point inspection](inspection.md): click behavior, source/recipe provenance, picking and frame ownership.
- [Ideas index](ideas/README.md): analysis proposals, recipe experiments, and future pipeline work.
- [Recipe experiments](recipe-experiments.md): reusable differences, delayed coordinates and entropy contrast with ordinary expressions.
- [Multibyte encoding ideas](<ideas/MULTIBYTE ENCODING IDEAS.md>): implemented bounded UTF-8 inspection and proposed wider text interpretations.
- [Rendering and performance](rendering.md): worker protocol, stale frames,
  caches, particle rasterization, quality feedback, and memory costs.
- [Recipes and shader contract](recipes.md): the expression format, types,
  operation reference, provider requirements, precision, and backend boundaries.
- [Development and testing](development.md): commands, test limitations,
  extension checklists, and common failure modes.
- [Detailed next steps](ideas/next-steps.md): proposed priorities, implementation options,
  tradeoffs, and validation criteria for further improvements.
- [Direction and open decisions](ideas/roadmap.md): what the general pipeline is meant
  to become and which design questions remain unresolved.
- [Sequential implementation plan](ideas/PLAN.md): combined analysis, infrastructure and CantorDust-inspired backlog with delivery evidence.

See [pipeline contracts](pipeline.md) for populations, sampling, profiles, precision,
and backend boundaries.

For a first source pass, read `main.js`'s `DataScroll.updateLevels`, then
`DataScrollView.render`, `render-engine.js`, and `rendering.js`'s `executeRender`.
For recipes, follow `recipes.js` → `point-factors.js` → `point-renderer.js`.
