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

| Area | Current behavior |
| --- | --- |
| Selection | A full-screen view with zero or more nested overview bars; yellow selectors identify each child scope. |
| Navigation | Wheel and keyboard movement, draggable selector edges, middle-button velocity scrolling/resizing, and 3D rotation. |
| Presets | Linear, Hilbert, Digraph, DFT, and Trigraph. Unchanged presets retain specialized CPU paths. |
| Spaces | Square, circle, cube, cylinder, sphere; scalar factors map to their positional channels. |
| Point appearance | Hue, saturation, lightness, opacity, size, and square/circle marks. Character or hex overlays are optional. |
| Factor recipes | Primitive sources, arithmetic, byte lookup, local entropy, spectrum sampling, coordinate vectors, named scalar factors, and shared subexpressions. |
| Scheduling | Predicted expensive jobs use a worker when supported; ordered presentation and adaptive 3D quality preserve interaction. |
| Point population | Byte samples, distinct pairs/triples, or spectrum bins; independent analysis factors remain mixable. |
| Sampling | General points default to at most 262,144 samples; selection ranges and exact statistical providers stay independent. |
| Shader preparation | The typed recipe graph emits GLSL and WGSL function libraries with explicit provider interfaces. |

Version 1 profiles can be exported/imported as JSON through `view.exportProfile()`
and `view.importProfile(profileOrJSON)`. They include named factors, population,
sampling budget, geometry, appearance, camera, and backend settings. Hosts can
store that JSON in files or localStorage. There is no automatic persistence or
profile-library UI; reloading without saving still loses settings.

## Read next

- [Architecture and source map](architecture.md): ownership, element APIs,
  compatibility paths, events, and a configuration example.
- [Selection and sampling](data-selection.md): coordinate systems for offsets,
  nested scopes, snapping, and what a rendered sample actually represents.
- [Rendering and performance](rendering.md): worker protocol, stale frames,
  caches, particle rasterization, quality feedback, and memory costs.
- [Recipes and shader contract](recipes.md): the expression format, types,
  operation reference, provider requirements, precision, and backend boundaries.
- [Development and testing](development.md): commands, test limitations,
  extension checklists, and common failure modes.
- [Detailed next steps](next-steps.md): proposed priorities, implementation options,
  tradeoffs, and validation criteria for further improvements.
- [Direction and open decisions](roadmap.md): what the general pipeline is meant
  to become and which design questions remain unresolved.

See [pipeline contracts](pipeline.md) for populations, sampling, profiles, precision,
and backend boundaries.

For a first source pass, read `main.js`'s `DataScroll.updateLevels`, then
`DataScrollView.render`, `render-engine.js`, and `rendering.js`'s `executeRender`.
For recipes, follow `recipes.js` → `point-factors.js` → `point-renderer.js`.
