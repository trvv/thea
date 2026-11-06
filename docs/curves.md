# Hilbert, Morton and H-curve coordinates

All three mappings coexist. They turn an explicit scalar or integer input into
coordinates; they do not reorder bytes for entropy, FFTs or other providers.
The point population and every appearance/position mapping remain independent.

| Curve   | Construction                                                        | Sequential behavior                                 | Current dimensions                  |
| ------- | ------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| Hilbert | Rotated/reflected recursive sub-squares/cubes                       | Edge-adjacent successive cells                      | 2D and 3D                           |
| Morton  | Interleaved coordinate bits, repeating Z order                      | Can jump between blocks                             | 2D and 3D                           |
| H-curve | Recursive triangular subdivision, CantorDust-compatible orientation | Edge-adjacent cells; final cell neighbors the first | 2D, embeddable in any display space |

Hilbert is useful for following contiguous byte sequences. Morton can reveal
data stored with tiled/bit-interleaved addresses. H-curve folds sequences into
different groups for comparison. None makes every neighboring screen cell a
neighbor in the file, and H-curve's end/start adjacency does not assert cyclic data.

Preset → Load offers Hilbert, Hilbert 3D, H-Curve, Morton and Morton 3D. Curves
also appear under Transform in individual expression menus. Presets supply
ordinary configuration, retain the default local-entropy hue, and can be saved,
mixed, dimension-scaled or edited normally. The last selected template restores
on refresh. There is no new renderer or global Layout setting.

```js
import { hCurveCoordinate } from "./recipes.js";
view.pointConfiguration = {
  ...view.pointConfiguration,
  position: [hCurveCoordinate(0), hCurveCoordinate(1), "none"],
};
```

`hCurveCoordinate` projects a shared `{op: "hcurve", input: {op: "pointIndex"},
order: 0}` vector. Integer inputs select exact cells; scalar inputs span the
curve from zero through its final cell. Automatic order uses population count
for index inputs and selection length for scalar inputs. Orders 1–15 choose a
side of `2**order`; automatic singleton order is zero. The limit keeps the curve
within 30 bits and signed-32-bit shader arithmetic. Inputs clamp to the available
curve; nonfinite scalar input selects its first cell. Natural dimensions use the
curve side, while the user's Fit/Scale/Truncate controls retain their meaning.

The H traversal matches [CantorDust revision 32aff417](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/HCurve.java).
Thea uses constant-memory affine descent, without copying its mutable inverse
cache. Fixed traversal fixtures establish orientation; exhaustive small grids
check uniqueness, bounds, successive adjacency and end/start closure. CPU and
generated GLSL agree on automatic, scalar, large-index and endpoint fixtures.
WGSL is generated but retains the existing untested-device limitation.

`tests/hcurve.js` covers the numerical contract, sharing, source laziness,
parameter menus and inspection. Component tests cover all curve templates and
refresh; the shader suite executes four H-curve graphs against CPU results.
