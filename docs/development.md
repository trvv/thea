# Development and testing

## Project constraints

Read [AGENTS.md](../AGENTS.md) before editing. The project favors native JavaScript
primitives, minimal functional styling, and no unsolicited instructional/status
copy in the page. Keep developer explanations here and explain invariants beside
the code. There is no framework or build pipeline to preserve.

Run a static server from the repository root, put a sample under `examples/`, and
open the fragment URL described in [the overview](README.md). A fresh clone can
have a blank display simply because the ignored default sample is missing. Check
the console and network response before debugging projection or canvas state.

Browser APIs used include custom elements, shadow DOM, native popovers,
ResizeObserver, pointer capture, AbortController-managed listeners, Canvas 2D, and
module workers. OffscreenCanvas/ImageBitmap worker support is detected and has a
local fallback. Popover support is used directly, without a legacy overlay
fallback. The full-screen host style is deliberate; embedding it in an ordinary
page requires an intentional host-layout change.

## Test commands

Tests are executable Bun scripts using assertions, not a `bun test` discovery
suite. Run from the repository root:

```sh
for test in recipes recipe-shaders hilbert arrangements pipeline point-factors point-configuration appearance \
  data-scroll context-menu render-engine render-thread-smoke trigraph \
  trigraph-opacity coordinates adaptive-resolution scroll-performance digraph fourier
do
  bun "tests/$test.js" || exit 1
done
```

There is no package installation step. Bun is needed for worker tests and process
APIs; some tests import Node-compatible assertion/filesystem modules through Bun.
`tests/recipe-shaders.js` also invokes Python 3. The EGL/GLES runtime libraries are
optional: the shader test reports a skip when they or a surfaceless display are
unavailable. Inspect its output; exit zero is not proof that shader execution ran.

`tests/render-canvas.js`, `tests/render-thread.js`, and `tests/recipe-glsl.py` are
helpers, not standalone JS test entry points. The Python helper consumes generated
fixtures. `tests/scroll-benchmark.js` is a separate, non-gating CPU benchmark:

```sh
bun tests/scroll-benchmark.js
```

The real-browser integration suite needs Chromium (no npm dependency). It serves
its own temporary local fixture and launches headless Chromium:

```sh
bun tests/browser-smoke.js
# Set CHROMIUM_PATH if the executable is not /usr/bin/chromium-browser.
```

It checks real workers/ImageBitmaps, CPU/WebGL coverage and context-loss fallback,
DPR/text sizing, population preservation, source replacement, profile round trips,
native popover keyboard/focus behavior, and worker cleanup. Browser startup requires
permission to launch processes and bind a local port in restricted environments.

### What the tests establish

| Tests | Main regressions guarded against |
| --- | --- |
| `data-scroll` | Nested scope containment, true source bytes, root/local offsets, snapping/anchors, zero bars, recipe state and navigation sync. |
| `context-menu` | Native popover ownership, focus restoration, keyboard/hover behavior, submenu flipping, numeric input. |
| `render-engine` | Local/worker parity with a worker double, routing, bounded pending queue, stale-frame rejection, bitmap cleanup, fallback. |
| `render-thread-smoke` | Actual Bun worker execution of the shared renderer and timer progress on the main thread. |
| `adaptive-resolution` | Sustained miss/fast thresholds, recovery, unsuccessful-reduction rollback, DPR footprints, selection stability. |
| `trigraph`, `trigraph-opacity` | Sliding tuple boundaries, exact incremental/fresh equivalence, owner repair, soft edges, projection, white opacity updates. |
| `coordinates`, `point-configuration` | Coordinate conventions, repeated mappings, all spaces, sample/camera/raster cache boundaries. |
| `point-factors` | Laziness, exact neighbors, entropy/histogram/FFT reuse, hidden axes, selection boundaries, empty/short inputs. |
| `arrangements` | Column/Row/Slice strides, layout placement across populations, unchanged sampling, 3D mark sizing, and profile migration. |
| `hilbert` | True 3D Hilbert orientation, exhaustive small-cube uniqueness/adjacency, exact large indices, vec3 sharing, menu deduplication, and population semantics. |
| `recipes` | Typed DAGs, sharing, named references, cycle/type limits, menu edits, configurable entropy, serialization, shader emission. |
| `recipe-shaders` | Representative generated GLSL compiled, linked, executed, and compared against CPU results; WGSL structural generation checks. |
| `appearance`, `scroll-performance` | Palette parity, fractional rounding, source/cache reuse and bounded overview storage. |
| `digraph`, `fourier` | Overlapping pairs, chunk/selection boundaries, defining DFT sums, prime lengths, phase/frequency convention, amplitude scaling. |

DOM/canvas doubles do not validate browser fonts, text compositing, real native
popover geometry, or all CSS behavior. `fillRect`/`fillText` in the canvas double
record commands rather than reproducing a browser rasterizer. The Bun worker
smoke test substitutes that canvas double for OffscreenCanvas, so it does not
prove browser ImageBitmap behavior or GPU presentation.

The GLES recipe test uses an offscreen context and provider stubs. It validates
shader-language execution for representative graphs within one color step, not a
complete browser WebGL pipeline or all possible numerical inputs. WGSL has not
been exercised against a WebGPU device in this workspace.

### Browser checks after changing controls or presentation

Use a real browser to inspect resize/high-DPR behavior, native menu focus and
clipping, text/hex legibility, scroll/resize anchoring, middle-button latching and
cancellation, 3D rotation, and idle detail restoration. Replace the source or
change recipes while renders are pending and confirm that old configurations
never reappear. Canvas-double tests are a useful complement, not a substitute.

## Extending the system

### Add an expression operation

1. Define its type, inputs, range/units, and behavior at empty/out-of-range data.
2. Add validation, interning parameters, and CPU instructions in `recipes.js`.
3. If it needs selected-window data, declare that provider dependency explicitly;
   prepare/cache it in `point-factors.js`. Do not put an FFT or histogram build
   inside a per-point instruction.
4. Emit equivalent GLSL/WGSL in `recipe-shaders.js`, with any provider descriptors.
5. Add menu descriptors in `recipe-menu.js` and document the expression format.
6. Test numerical results, type/cycle rejection, identical-expression sharing,
   unused-provider laziness, structured cloning, and local/worker parity. Extend
   shader execution fixtures when the operation can be exercised there.

The source-factor catalog should grow only for primitive measurements. Prefer a
recipe over adding a new built-in enum for each combination or normalization.
Adding a canonical slot is an ABI change: update `factorCount`, providers, and
shader source inputs together. Native compact factor arrays are separate.

### Add a space or change projection

Update space channels, validation/geometry, menu labels, and 2D/3D interaction
classification. `spaces.js` supplies channel counts to recipes, controls, and
geometry; add the corresponding transform in `point-configuration.js`. Preserve axis
conventions, angular seams, normalized bounds, and continuous perspective size.
If changing native tuple projection too, audit `coordinates.js`, wireframes,
spatial-bin reach, and the dirty visibility tests.

### Add a setting

Trace it through component state, jobs, worker cloning, prepared-point keys,
presentation compatibility, and quality-feedback checks. A setting that changes
pixels but is absent from stale-frame identity can make old frames flash back
into view. A setting that changes only the camera should not force new source
reads or a new FFT.

Avoid "fixing" a performance issue by rendering stale settings, dropping selected
bytes silently, or shrinking source selections along with the raster.

## Common traps

| Symptom | First thing to check |
| --- | --- |
| Nothing displays on a fresh clone | The ignored `examples/cat` default may not exist; inspect fetch status and the console. |
| A file path in the fragment fails | It is a browser URL under the static server, not a host filesystem path; inspect the resolved request/CORS response. |
| Navigation and the bar disagree | Root-relative view offsets versus parent-local bar offsets. |
| Selection drifts during resize | Lost `anchorEnd`, snapping from committed rather than requested length, or raster dimensions used as sample columns. |
| Repeated Hilbert cells | Square-fill sampling can repeat representative bytes; inspect sampling before blaming source duplication. |
| A manual position recipe seems inactive | Programmatic manual mappings require `layout: "mapped"`; menu axis edits select it automatically. |
| Raw preset-like output looks different | Native tuple/bin aggregation and raw byte-offset points are different sample domains. |
| Expression mostly saturates | Raw `byte` gives 0–255; built-ins are normalized; final outputs clamp to 0–1. |
| Neighbor access is inaccurate far into a large selection | Keep address arithmetic in index operations; visual float32 operations can still lose precision. Shader indices are signed 32-bit. |
| Rare trigraph corruption after scrolling | Cancelled histogram mutation, missed revision, dense-slot owner repair, or insufficient spatial-bin reach. |
| More workers do not speed scrolling | Data reads, cache duplication, fixed per-point preparation, sorting, or transfer/presentation can dominate. |
| Reduced resolution stays equally slow | The bottleneck may be source/statistical/point work; see adaptive rollback. |
| Text counts as a passing pixel test but looks wrong | The test double records text commands; actual fonts/combining glyphs are browser behavior. |
| A "shader" option does not use the GPU | The compatibility flag is a renderer setting; emitted recipe functions still need a GPU backend. |

## Version control and local artifacts

`examples/` and `.snapshots/` are ignored and not build inputs. The pre-recipe
snapshot, when present, is commit `c2c5c3c9225c3c818a475155efb8c302cb096b80` inside
`.snapshots/before-factor-recipes.bundle`. It was made through a separate Git
repository because that development session mounted `.git` read-only. This is a
sandbox limitation, not a requirement of Thea or an ordinary Unix ownership issue.

With a writable checkout, the bundle can be imported without replacing files:

```sh
git fetch .snapshots/before-factor-recipes.bundle main
git show --stat FETCH_HEAD
```

Review that fetched commit before choosing any merge/reset operation. The bundle
captures the state before recipes, not the current working-tree documentation.
Do not commit binary samples or recursive snapshot bundles as source code.
