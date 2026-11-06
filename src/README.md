# Source map

`bootstrap.js` mounts the demo and loads its URL-selected source. `main.js`
registers the reusable custom elements and owns browser selection/navigation.
Importing `main.js` does not mount the demo.

| Directory     | Responsibility                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `analysis/`   | Byte/text/numeric interpretation, statistical models, histograms, entropy and spectral calculations.            |
| `data/`       | Populations, source reads, sparse/dense preparation, bounded scans, provider budgets, caches and diagnostics.   |
| `recipes/`    | Typed expressions, compilation, shader emission, factors, dimensions, position and appearance configuration.    |
| `render/`     | Scheduling, worker leases, frame identity, point preparation, projection, sorting and CPU/GPU raster/execution. |
| `inspection/` | Picking, contributing-source provenance and point-popup content.                                                |
| `presets/`    | Configuration factories, profiles, preset storage/editing and bookmarks.                                        |
| `ui/`         | Menu descriptors, browser file controls, byte glyphs and stylesheet attachment.                                 |
| `math/`       | Coordinate-curve and rank-selection algorithms.                                                                 |

The main execution path is:

```text
main.js → render/render-engine.js → render/rendering.js
        → data/point-factors.js + recipes/recipes.js
        → render/point-renderer.js → projection/raster
```

`index.html` and `styles.css` remain at the repository root. The stylesheet is
linked by each shadow root, using component-scoped selectors and named classes.
`ui/styles.js` only attaches the stylesheet and waits for it before layout
measurements. Dynamic positions, dimensions and interaction state remain DOM
properties in the components.

Tests remain in `tests/`, design/current-behavior documentation in `docs/`, and
example binaries in `examples/`. No bundler or build step is required.
