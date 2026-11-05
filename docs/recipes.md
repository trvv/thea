# Factor recipes and shader interfaces

## Expressions, definitions, and mappings

A mapping is `none`, a built-in factor name, or a plain expression object. Objects
carry an `op` and inputs/parameters. They are data rather than executable
JavaScript, and survive structured cloning to the worker. Menu labels are
summaries, not a textual language that can be parsed back into a recipe.

The menus expose **Source**, **Transform**, and operation parameters. **Save
Factor** creates a named scalar definition; **Factors** edits definitions. A
reference is explicit (`{op: 'ref', name: 'Neighbor'}`), so custom names cannot
silently shadow built-in factor strings. Definitions remain available when
switching presets, but currently live only in memory: reload loses them.

```js
const neighbor = {
  op: 'normalize', min: 0, max: 255,
  input: {
    op: 'byte',
    offset: { op: 'add', a: { op: 'offset' }, b: { op: 'constant', value: 1 } }
  }
};
view.setFactor('Neighbor', neighbor);
view.appearance = {
  ...view.effectiveAppearance,
  lightness: { op: 'ref', name: 'Neighbor' }
};
```

A raw byte read yields 0–255, while a built-in `value`/neighbor factor is already
normalized. Final display outputs clamp to 0–1: forgetting normalization after a
raw read makes most nonzero bytes saturate, rather than expanding the color range.
`offset` and `length` are selection-relative byte quantities, not normalized values.

## Shared coordinate expressions

```js
const curve = { op: 'hilbert', input: 'position', order: 0 };
view.pointConfiguration = {
  ...view.pointConfiguration,
  position: [
    { op: 'component', input: curve, component: 0 },
    { op: 'component', input: curve, component: 1 },
    'none'
  ]
};
```

The two expressions share one Hilbert vector operation after compilation, even if
serialization produced two distinct JavaScript objects. They can feed position,
hue, opacity, or another scalar operation. Order 0 chooses a power-of-two side
from selected length; orders 1–15 choose side `2 ** order`. Coordinates are
normalized cell centers. `linear` instead uses the current sample grid. Neither
expression requires the global Layout setting to be the same traversal.

`f32`, exact CPU `index`, and `vec2` are currently implemented. A display channel and a saved named
factor must end in a scalar (including an index). A vector can be shared inside multiple scalar
expressions, but saving an unprojected vector as a named definition is rejected.
There are no general vector constructors or 3D Hilbert operations yet.

## Built-in sources

The public choices come from `factor-catalog.js` and feed the same pool for all
position and appearance channels:

| Source | Normalized meaning |
| --- | --- |
| `value` | Byte value / 255; sequential downsampling may average an interval. |
| `previous`, `byte2`, `byte3` | Byte at sample offset −1, +1, +2, divided by 255; unavailable neighbors are zero. |
| `position` | Sample byte offset / `max(1, selectedLength - 1)`. |
| `column`, `row` | Generated sample-cell center, affected by global Linear/Hilbert layout. |
| `entropy` | Quantized Shannon entropy in a rolling 32-byte neighborhood. |
| `byteCount`, `pairCount`, `tripleCount` | Occurrence count of the sample's byte/sliding pair/sliding triple over the selection, mapped through `1 - exp(-0.25 * log1p(count))`. |
| `frequency` | One-sided bin frequency relative to Nyquist; no transform is required for indices alone. |
| `phase` | DFT phase mapped from −π…π to 0…1, with numerical real-axis stabilization. |
| `amplitude` | One-sided amplitude, log-scaled relative to the window's peak; negligible numerical noise is suppressed. |

`byte1` is a compatibility alias for `value`. Legacy `count` follows the historical
preset: pairs for Digraph, triples for Trigraph, byte occurrences otherwise. New
recipes should use an explicit count name to avoid preset-dependent meaning.

Canonical slots are stable and shared with emitted shaders. Compact native preset
factor arrays are a different layout: native byte2/phase occupy slot 1/0, for
example, whereas canonical byte2/phase occupy 6/9. `compileAppearance` explicitly
bridges these modes. Never pass a compact native tuple to the general evaluator.

## Operation reference

A string factor name is shorthand for `{op: 'factor', name}`. `none` is a mapping
sentinel, not an arithmetic expression; use a constant inside a recipe.

| Operation | Fields | Output / reason |
| --- | --- | --- |
| `constant` | `value` | Scalar literal. |
| `factor` | `name` | Scalar primitive source. |
| `ref` | `name` | Named scalar definition, expanded during compilation. |
| `offset`, `length` | none | Current sample offset or selected byte length. |
| `add`, `subtract`, `multiply`, `divide` | `a`, `b` | Scalar arithmetic; division by zero returns zero. |
| `invert` | `input` | `1 - input`. |
| `abs`, `floor`, `fract` | `input` | Absolute, floor, or input minus floor. |
| `power` | `input`, `exponent` | `max(input, 0) ** exponent`; exponent 0 returns 1. |
| `normalize` | `input`, `min`, `max` | Clamp `(input - min) / (max - min)` to 0–1. |
| `clamp` | `input`, `min`, `max` | Clamp to the given interval. |
| `byte` | `offset` | Raw byte at a floored, selection-relative offset; outside the selection returns zero. |
| `entropy` | `offset`, `window` | Local normalized entropy at an explicit byte offset. |
| `spectrum` | `input`, `kind` | Sample normalized one-sided spectrum position; kind is `phase`, `frequency`, or `amplitude`. |
| `linear` | `input` | vec2 cell center from a normalized traversal input and current sample grid. |
| `hilbert` | `input`, `order` | vec2 cell center along a power-of-two Hilbert square. |
| `component` | `input`, `component` | Extract X (0) or Y (1) from a vec2. |

Vector inputs cannot be passed directly to scalar arithmetic. Shapes and camera
transforms are outside this expression language; recipe outputs supply their
normalized channels.

### Local entropy boundaries

`entropy` uses surrounding root-file bytes where available, including outside the
selected region. This is intentional context for a local statistic; a `byte`
recipe is instead bounded to the selection. Provider reads acquire the largest
required halo before calculating the requested entropy arrays.

Entropy normalizes by `min(8, log2(window))`, the requested window's achievable
maximum, rather than the number of bytes available at a file edge. Window 1
therefore produces zero. The existing 32-byte implementation retains its 8-bit
quantization; other windows use normalized Float32 values. Explicit entropy
lookups outside the selected offset range return zero.

### Spectral sampling is an explicit relationship

The transform consumes the selected bytes once. It produces `floor(N/2) + 1`
one-sided coefficients for real input. A spectrum expression samples bin
`min(binCount - 1, floor(clamp(input, 0, 1) * binCount))`. An input of 1 reaches the
last bin. A frequency-only expression computes indices without reading bytes or
running an FFT.

Built-in spectral factors use the sample's relative byte offset to choose a bin;
explicit spectrum recipes can define a different relationship. This is not a
localized FFT or a claim that a coefficient describes one particular byte.
Native DFT rendering also aggregates bins into pixels before scaling, so it need
not match a raw per-point spectrum mapping exactly.

## Compilation and execution

`recipeRoots` starts at visible position channels and active appearance channels.
A 2D space does not reach its stored Z expression. `compileRecipes` expands named
references, validates types, interns identical operations, and orders nodes after
their inputs. The resulting runtime program contains:

- `nodes`: `{id, op, type, args, ...parameters}`; args refer to earlier node IDs;
- `outputs`: channel name → terminal node ID;
- `bindings`: channel name → appended scalar slot after the canonical inputs;
- `required`: reachable built-in sources;
- `providers`: raw-byte, entropy-window, and spectrum-component requirements;
- `createEvaluator()`: an instruction list with private scratch storage with explicit float32 visual rounding and exact indices.

IR node data is portable; the evaluator factory and scratch arrays are derived
runtime state, not saved recipe JSON. Plans can be shared; evaluator scratch cannot
be shared across concurrently rendering canvases. CPU evaluation writes clamped,
finite outputs into synthetic factor slots, then `compilePosition` and
`compileAppearance` consume those slots. Nonfinite outputs become zero.

The provider stage prepares only reachable statistics. Phase and amplitude share
one FFT; adding amplitude later reuses complex coefficients already cached for
phase. Each entropy window is cached independently. Camera and output-quality
changes reuse prepared points. See [cache ownership](rendering.md#what-gets-cached).

Validation limits currently include 32 levels of recursion, 256 distinct compiled
operations, 2048 traversal visits, 64 named definitions, 64-character names, finite
numeric parameters within ±1,000,000, power exponents 0–16, entropy windows 1–4096,
and Hilbert orders 0–15. Named definitions are validated even when unused, although
their providers do not run until reachable. Direct and indirect cycles are errors.

### Precision is part of the contract

Visual scalar/vector intermediates round to float32 after each instruction.
`offset` and `length` instead produce `index` values. Addition, subtraction, and
multiplication involving indices and integer constants preserve that type. CPU
index arithmetic uses JavaScript safe integers and throws on overflow rather than
silently addressing another byte. Other operations convert to visual scalar
arithmetic; built-in normalized factors remain float32 in the expression graph.

The generated GLSL/WGSL evaluator takes integer point offsets and selection lengths.
Byte/entropy provider wrappers consume integer offsets. Its `maxIndex` is
2,147,483,647: hosts must bound all index arithmetic to signed 32-bit range or use
CPU fallback/paging. This is a narrower range than CPU safe integers. A GLES
execution fixture checks neighboring-byte access above `2 ** 24`.


## Appearance and space conversion

None position channels supply 0.5 before geometry conversion. That is the center
of a Cartesian axis, but a half-radius for a radial channel. Square/cube map to
normalized Cartesian coordinates; circle/cylinder/sphere interpret mapped scalars
as radius and angles. Square fills the viewport and may be stretched; circle uses
the smaller screen dimension. The space name does not imply every physical cell
is a square.

Appearance hue spans 0–300 degrees (red through magenta). An unmapped saturation is
0.75 when hue is mapped, otherwise zero. Mapping saturation without hue uses a
fixed red hue. Colored lightness stays in 0.15–0.85 so 00/FF do not lose all hue;
grayscale uses the full mapped range. None opacity and size mean fully opaque and
unit size. Mapped size spans 0.5–2 times the base mark size. Text labels still use
actual sampled bytes, not the normalized or transformed scalar used for color.

## Shader generation and its boundary

```js
import { compileRecipes } from '../recipes.js';
import { emitRecipeShader } from '../recipe-shaders.js';
const program = compileRecipes({ lightness: { op: 'ref', name: 'Neighbor' } }, { Neighbor: neighbor });
const { source, bindings } = emitRecipeShader(program, 'wgsl'); // or 'glsl'
```

The result is a **function library**, not a complete shader module with a stage
entry point or a configured GPU pipeline. It provides
`evaluateRecipes(sourceFactors, pointOffset, selectionLength, grid)` returning a
`RecipeResult` whose fields match the requested roots. The built-in source array
has the canonical factor-slot layout; only `program.required` slots need values.

The returned binding descriptors identify externally supplied functions:

| Function | Required return value |
| --- | --- |
| `recipeReadByte(index)` | Raw byte value as a float. |
| `recipeReadEntropy<N>(index)` | Normalized local entropy for that requested window size. |
| `recipeReadSpectrumPhase(index)` | Normalized one-sided phase. |
| `recipeReadSpectrumAmplitude(index)` | Normalized one-sided amplitude. |

Indices are signed integers. Generated wrappers bound-check byte/entropy offsets
and turn normalized spectral positions into bin indices. Frequency-only sampling
needs no provider binding. GLSL includes forward declarations; WGSL expects the
provider implementations in the same linked source module.

A backend executing these functions must still provide storage bindings, source-factor values,
camera/space transforms, appearance-to-color conversion, particle/text drawing,
blending, output targets, lifecycle handling, and capability/failure fallback.
FFT/histogram/entropy preparation still runs on the CPU/worker. Those arrays can
later be uploaded or replaced with compute providers without changing the saved
expression format. Storage choices do not belong in the user's recipe.

Generated GLSL is compiled and executed against a surfaceless GLES context in
`tests/recipe-shaders.js`, comparing representative results within one 8-bit color
step. That validates examples, not every graph or browser integration. WGSL is
structurally checked but has not been validated on a WebGPU device in this
workspace. The opt-in WebGL point rasterizer uses prepared CPU results; it does not execute
these emitted recipe functions. WebGPU drawing and provider compute are not integrated.
