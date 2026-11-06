# Factor recipes and shader interfaces

## Expressions, definitions, and mappings

A mapping is `none`, a built-in factor name, or a plain expression object. Objects
carry an `op` and inputs/parameters. They are data rather than executable
JavaScript, and survive structured cloning to the worker. Menu labels are
summaries, not a textual language that can be parsed back into a recipe.

The menus expose **Source**, **Transform**, and operation parameters. Source has
one canonical entry per primitive plus exact byte/population quantities and
constants; saved factors have their own group. Configurable byte/entropy/spectrum
lookups and coordinate conversions live under Transform. **Save
Factor** creates a named scalar definition; **Factors** edits definitions. A
reference is explicit (`{op: 'ref', name: 'Neighbor'}`), so custom names cannot
silently shadow built-in factor strings. Definitions remain available when
switching presets and are included in saved presets. Unsaved changes remain in
memory; explicitly save or update a preset to preserve them across reloads.

```js
const neighbor = {
  op: "normalize",
  min: 0,
  max: 255,
  input: {
    op: "byte",
    offset: { op: "add", a: { op: "offset" }, b: { op: "constant", value: 1 } },
  },
};
view.setFactor("Neighbor", neighbor);
view.appearance = {
  ...view.effectiveAppearance,
  lightness: { op: "ref", name: "Neighbor" },
};
```

A raw byte read yields 0–255, while a built-in `value`/neighbor factor is already
normalized. Final display outputs clamp to 0–1: forgetting normalization after a
raw read makes most nonzero bytes saturate, rather than expanding the color range.
`offset` and `length` are selection-relative byte quantities, not normalized values.

## Shared coordinate expressions

```js
const curve = { op: "hilbert", input: "position", order: 0 };
view.pointConfiguration = {
  ...view.pointConfiguration,
  position: [
    { op: "component", input: curve, component: 0 },
    { op: "component", input: curve, component: 1 },
    "none",
  ],
};
```

The two expressions share one Hilbert vector operation after compilation, even if
serialization produced two distinct JavaScript objects. They can feed position,
hue, opacity, or another scalar operation. Order 0 chooses a power-of-two side
from selected length for normalized input or population count for integer input; orders 1–15 choose side `2 ** order`. Coordinates are
normalized cell centers. `linear` instead uses the current point grid’s column/row dimensions. Both are
explicit transformations of their input; no global arrangement overrides them.

`f32`, exact CPU `index`, `vec2`, and `vec3` are implemented. A display
channel and a saved named factor must end in a scalar (including an index).
Vectors can be shared inside multiple scalar expressions. General vector
constructors are not implemented.

### Three-dimensional Hilbert coordinates

```js
import { hilbert3DCoordinate } from "./recipes.js";
view.pointConfiguration = {
  ...view.pointConfiguration,
  space: "cube",
  footprint: "point",
  position: [0, 1, 2].map((axis) => hilbert3DCoordinate(axis)),
};
```

The helper constructs scalar projections of
`{op: 'hilbert3d', input: {op: 'pointIndex'}, order: 0}`. X/Y/Z share one
compiled `vec3` evaluation. In the menu, choose Source → Point Index and then
Transform → Hilbert 3D → X/Y/Z for the respective position channels.

For an integer (`index`) input, the value is an exact cell index, clamped to
`[0, side ** 3 - 1]`. For an `f32` input, its clamped 0–1 value spans the entire
curve, with 1 reaching the final cell. Use Point Index for exact adjacency beyond
float32's adjacent-integer limit. Normalized Position remains available when a
proportional traversal is intended.

Order 0 chooses `ceil(log2(max(1, pointCount)) / 3)`, capped at 10. Explicit
orders 1–10 use a cube with side `2 ** order` and `2 ** (3 * order)` cells.
A one-point automatic curve has one centered cell. The shared CPU/shader limit
keeps curve indices within signed 32-bit arithmetic; integer inputs beyond the
chosen cube's capacity clamp to its endpoint. Coordinates are normalized cell
centers. The orientation follows Skilling's transpose/Gray-decode construction
([paper](https://doi.org/10.1063/1.1751381)) and is locked by an order-1 fixture.

Point Index/Count refer to the unsampled population: selection-relative byte
index/length for byte points, distinct-tuple ordinal/count for tuple points, and
frequency-bin index/count for bins. Sample limits do not renumber surviving
points. These operations do not read bytes or execute an FFT by themselves;
tuple discovery still needs to inspect the selected bytes.

This is an explicit coordinate expression, independent of display space and
other position mappings. It does not reorder the input to FFT, entropy, or occurrence
providers. Existing explicit 2D Hilbert expressions retain their conventions. The Hilbert preset itself uses explicit 2D coordinate expressions.

## Built-in sources

The public choices come from `factor-catalog.js` and feed the same pool for all
position and appearance channels:

| Source                                  | Normalized meaning                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `value`                                 | Byte value / 255; sequential downsampling may average an interval.                                                                    |
| `previous`, `byte2`, `byte3`            | Byte at sample offset −1, +1, +2, divided by 255; unavailable neighbors are zero.                                                     |
| `position`                              | Sample byte offset / `max(1, selectedLength - 1)`.                                                                                    |
| `column`, `row`, `slice`                | Normalized cell centers generated from dimension ranges/steps and width/height/depth strides.                                         |
| `entropy`                               | Quantized Shannon entropy in a rolling 32-byte neighborhood.                                                                          |
| `byteCount`, `pairCount`, `tripleCount` | Occurrence count of the sample's byte/sliding pair/sliding triple over the selection, mapped through `1 - exp(-0.25 * log1p(count))`. |
| `frequency`                             | One-sided bin frequency relative to Nyquist; no transform is required for indices alone.                                              |
| `phase`                                 | DFT phase mapped from −π…π to 0…1, with numerical real-axis stabilization.                                                            |
| `amplitude`                             | One-sided amplitude, log-scaled relative to the window's peak; negligible numerical noise is suppressed.                              |

`byte1` is a compatibility alias for `value`. Legacy `count` follows the historical
preset: pairs for Digraph, triples for Trigraph, byte occurrences otherwise. New
recipes should use an explicit count name to avoid preset-dependent meaning.

Canonical slots are stable and shared with emitted shaders. Slice is appended at
slot 15, making 16 inputs; earlier slots retain their indices. Every preset and
custom configuration uses this layout. Compiled output slots follow the source
slots; appearance/position compilation consumes the program's bindings.

## Operation reference

A string factor name is shorthand for `{op: 'factor', name}`. `none` is a mapping
sentinel, not an arithmetic expression; use a constant inside a recipe.

| Operation                               | Fields                                                     | Output / reason                                                                              |
| --------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `constant`                              | `value`                                                    | Scalar literal.                                                                              |
| `factor`                                | `name`                                                     | Scalar primitive source.                                                                     |
| `ref`                                   | `name`                                                     | Named scalar definition, expanded during compilation.                                        |
| `offset`, `length`                      | none                                                       | Current compatibility byte offset or selected byte length, as an exact index.                |
| `pointIndex`, `pointCount`              | none                                                       | Exact unsampled population ordinal/count, independent of byte addressing.                    |
| `add`, `subtract`, `multiply`, `divide` | `a`, `b`                                                   | Scalar arithmetic; division by zero returns zero.                                            |
| `invert`                                | `input`                                                    | `1 - input`.                                                                                 |
| `abs`, `floor`, `fract`                 | `input`                                                    | Absolute, floor, or input minus floor.                                                       |
| `power`                                 | `input`, `exponent`                                        | `max(input, 0) ** exponent`; exponent 0 returns 1.                                           |
| `normalize`                             | `input`, `min`, `max`                                      | Clamp `(input - min) / (max - min)` to 0–1.                                                  |
| `clamp`                                 | `input`, `min`, `max`                                      | Clamp to the given interval.                                                                 |
| `bit`                                   | `input`, `bit`                                             | Extract bit 0–7 (least significant first) from a converted raw byte.                         |
| `popcount`                              | `input`                                                    | Number of set bits in a converted raw byte, in 0–8.                                          |
| `xor`                                   | `a`, `b`                                                   | Byte-width exclusive OR of two converted raw bytes, in 0–255.                                |
| `byte`                                  | `offset`                                                   | Raw byte at a floored, selection-relative offset; outside the selection returns zero.        |
| `available`                             | `offset`, `width`                                          | One if the complete selected byte span is available; zero otherwise, without reading bytes.  |
| `number`                                | `offset`, `format`, `endian`, `kind`, optional `min`/`max` | Native numeric interpretation normalized/classified before float32 display conversion.       |
| `entropy`                               | `offset`, `window`                                         | Local normalized entropy at an explicit byte offset.                                         |
| `spectrum`                              | `input`, `kind`                                            | Sample normalized one-sided spectrum position; kind is `phase`, `frequency`, or `amplitude`. |
| `linear`                                | `input`                                                    | vec2 cell center from a normalized traversal input and current sample grid.                  |
| `hilbert`                               | `input`, `order`                                           | vec2 cell center along a power-of-two Hilbert square.                                        |
| `hilbert3d`                             | `input`, `order`                                           | vec3 cell center on a Hilbert cube; exact index or normalized scalar input.                  |
| `morton`                                | `input`, `order`, `dimensions`                             | vec2/vec3 Morton Z-order cell center; X consumes the least-significant interleaved bit.      |
| `component`                             | `input`, `component`                                       | Extract X (0), Y (1), or Z (2); Z requires vec3.                                             |

Vector inputs cannot be passed directly to scalar arithmetic. Shapes and camera
transforms are outside this expression language; recipe outputs supply their
normalized channels.

### Byte bit operations

Bit operations take raw byte units. Each operand is floored after clamping to
0–255; nonfinite operands become zero. Conversion happens before integer bit
coercion, so large exact index operands saturate instead of wrapping. Inputs
still obey the existing float32 scalar arithmetic contract before conversion.
A normalized `value` factor therefore needs multiplication by 255 if raw byte
bits are intended; an explicit `byte(offset)` read already supplies raw units.
`bit` produces zero or one, but `popcount` and `xor` require explicit display
normalization by eight and 255 respectively. Hamming change composes
`popcount(xor(byte(i), byte(j)))`; its two source lookups retain the usual
selection-boundary behavior. Bit operations alone read no bytes and request no
statistical providers. They are available under Transform as Bit, Population
Count and Byte XOR, with the bit number editable from zero through seven.

### Complete spans and numeric interpretations

`available` floors its selection-relative offset, and accepts a constant width
from one to eight bytes (default one). It returns one only if the complete span
is inside the selected interval. It reads no bytes and does not change legacy
`byte` zero-fill behavior. This can mask missing predecessors or trailing words
without interpreting an unavailable value as a measured zero.

```js
const word = {
  op: "number",
  offset: { op: "offset" },
  format: "uint32",
  endian: "little",
  kind: "normalized",
  min: 4294967294,
  max: 4294967295,
};
```

`number` uses native DataView reads for `uint16`, `int16`, `uint32`, `int32` and
`float32`, with `little` (default) or `big` byte order. Addresses are floored,
selection-relative, and need no alignment. An incomplete span returns zero for
every projection, including `valid`. Reading actual addressed bytes is separate
from averaging a rendered sample's byte values. Numeric recipes currently use
the dense byte provider; they do not add an FFT or histogram dependency.

The default projection, `normalized`, computes the decoded Number's mapping to
the given finite increasing bounds **before** float32 conversion. Integers default
to their full type range. Float32 requires explicit bounds. Numeric bounds may
exceed the ordinary expression parameter limit of one million; only this operation
has that exception. The range difference must remain finite. Thus adjacent large
uint32 values can map distinctly under a narrow range, rather than being rounded
to the same raw float32 first. This operation does not expose a misleading raw
uint32 scalar through the float32 arithmetic IR.

Other projections are `valid`, `finite`, `nan`, `infinite`, `negativeZero` and
`sign`. `valid` means a complete span, independently of whether its decoded float
is finite. Float32 `sign` exposes its sign bit (including negative NaNs/zero);
integer `sign` is one for a negative value. Float32 additionally exposes
`exponent` (raw eight-bit exponent divided by 255) and `fraction` (raw 23-bit
fraction divided by 8,388,607). Nonfinite `normalized` results are zero; their
classification can control opacity independently. Inspection preserves exact
integer values, special-float strings, raw bits and contributing bytes. Float64
and integer64 remain separate future work.

The menu exposes Available Span and Read Number under Transform. Numeric format,
byte order, projection and normalization bounds remain ordinary expression data.

### Morton coordinates

`morton` has dimensions two (default) or three and an order of zero (automatic),
one through 15 for 2D, or one through 10 for 3D. This keeps curve indices within
30 bits. Order zero chooses `ceil(log2(max(1, count))/dimensions)`, capped at those
limits; exact index input uses population count, normalized input uses selection
length. A one-point curve is centered. X receives bit zero, Y bit one, Z bit two,
then higher coordinate bits follow the same interleaving. Results are cell centers.

```js
import { mortonCoordinate } from "../recipes.js";
view.pointConfiguration = {
  ...view.pointConfiguration,
  position: [mortonCoordinate(0), mortonCoordinate(1), "none"],
};
```

The helper accepts `(component, input = pointIndex, order = 0, dimensions = 2)`.
Integer inputs select exact clipped cells; normalized scalars span the curve with
one reaching its final cell. The coordinate vector is shared across component
expressions, independent of population, source order and other analyses. Morton
does not preserve Hilbert's neighboring-cell adjacency. Menus expose Morton 2D/3D
and editable order; H-curve remains deferred pending a complete algorithm contract.

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
All views use the shared point renderer; changing the mappings does not switch
to a separate DFT image painter.

## Compilation and execution

`recipeRoots` starts at visible position mappings and active appearance channels.
There is no alternative mapping set or Layout override.
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
changes reuse prepared points. See [cache ownership](rendering.md#independent-cache-boundaries).

Validation limits currently include 32 levels of recursion, 256 distinct compiled
operations, 2048 traversal visits, 64 named definitions, 64-character names, finite
numeric parameters within ±1,000,000, power exponents 0–16, entropy windows 1–4096,
2D Hilbert orders 0–15, and 3D Hilbert orders 0–10. Named definitions are validated even when unused, although
their providers do not run until reachable. Direct and indirect cycles are errors.

### Precision is part of the contract

Visual scalar/vector intermediates round to float32 after each instruction.
`offset`, `length`, `pointIndex`, and `pointCount` instead produce `index` values. Addition, subtraction, and
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
import { compileRecipes } from "../recipes.js";
import { emitRecipeShader } from "../recipe-shaders.js";
const program = compileRecipes(
  { lightness: { op: "ref", name: "Neighbor" } },
  { Neighbor: neighbor },
);
const { source, bindings } = emitRecipeShader(program, "wgsl"); // or 'glsl'
```

The result is a **function library**, not a complete shader module with a stage
entry point or a configured GPU pipeline. It provides
`evaluateRecipes(sourceFactors, pointOffset, selectionLength, grid, pointIndex, pointCount)` returning a
`RecipeResult` whose fields match the requested roots. The built-in source array
has the canonical factor-slot layout; only `program.required` slots need values.

The final two integer arguments describe the unsampled point population; they
are distinct from byte-offset/selection-length inputs. The returned binding
descriptors identify externally supplied functions:

| Function                             | Required return value                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `recipeReadByte(index)`              | Raw byte value as a float.                                                                       |
| `recipeReadEntropy<N>(index)`        | Normalized local entropy for that requested window size.                                         |
| `recipeReadSpectrumPhase(index)`     | Normalized one-sided phase.                                                                      |
| `recipeReadSpectrumAmplitude(index)` | Normalized one-sided amplitude.                                                                  |
| `recipeReadNumber<ID>(index)`        | Numeric projection defined by that binding descriptor, decoded/normalized before f32 conversion. |

Indices are signed integers. Generated wrappers bound-check byte/entropy offsets
and turn normalized spectral positions into bin indices. Frequency-only sampling
needs no provider binding. GLSL includes forward declarations; WGSL expects the
provider implementations in the same linked source module.

Numeric binding descriptors contain format, width, byte order, projection and
normalization bounds. Their wrapper checks the entire span before invoking the
provider. A GPU backend must honor the descriptor's pre-f32 normalization contract;
converting raw uint32 to a float texture first would violate narrow-range behavior.
Executed GLSL fixtures use independently prepared numeric provider results to
test these interfaces and boundaries; this is not evidence of GPU-side DataView
decoding or a numeric GPU analysis backend.

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
