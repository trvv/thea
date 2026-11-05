# Dimensions and coordinate mappings

Position mappings are the only source of point coordinates. There is no Layout
selector or implicit arrangement that replaces those mappings. Linear uses
Column/Row/Slice; Hilbert assigns explicit Hilbert coordinate expressions.

Each visible position axis has its own Start, End, Step, Range Mode, and Fit.
Cartesian axes are Width/Height/Depth. Circle, cylinder, and sphere use their
actual channel names: Radius, Angle, Height, Azimuth, and Inclination. Angular
range controls are in degrees.

## Ranges and cells

Ranges are half-open and Step determines the cell count:

```text
count = ceil((end - start) / step)
```

For example, Width 0–16 with Step 1 contains 16 cells. Width 0–16, Height 0–8,
and Depth 0–4 define 512 cells. Grid coordinates advance along width first, then
height, then depth. The final partial interval, if any, has its own centered cell. Direct mapped
values on a truncation window boundary are retained.
Two-dimensional spaces use only their two active axes; depth settings remain
stored for a later 3D space.

In Scale mode these counts set the generated grid. If the selected population
exceeds the grid capacity or sampling limit, representative samples span the
whole selection; byte values/entropy can average their corresponding intervals.
Ranges do not shorten the committed selected byte interval. Statistical providers
still analyze that interval. A grid larger than its population leaves cells empty.

## Scale, Truncate, and Fit

The default is **Scale with Fit on for every dimension**, including radial axes.
Both choices are independent for each axis.

| Range mode | Fit | Behavior |
| --- | --- | --- |
| Scale | On | Map the full input domain into the chosen range, then fit that range to the full axis. Positions retain their normalized placement; cell counts/resolution can change. |
| Scale | Off | Map all input values into the chosen physical extent, preserving its size relative to the natural axis. |
| Truncate | On | Hide points outside the chosen natural-domain window and expand the remaining window across the full axis. |
| Truncate | Off | Hide points outside the window and keep surviving points at their natural positions. |

For an angular range of 0–90°, Scale/Fit on distributes the input around a full
circle; Scale/Fit off compresses it into a quarter-circle. Truncate keeps only
input angles in that quarter: Fit on expands them to a full circle, and Fit off
keeps their quarter-circle placement. Truncate hides points rather than clamping
them onto a boundary.

Truncating generated coordinates keeps the original grid strides, so selecting
columns does not reflow other columns into the selected window. Step controls the
natural grid's sampling interval. The sample budget applies before truncation;
a small window can therefore contain fewer visible points than the budget.

With Scale and Fit both on, changing a range need not move an arbitrary mapped
point cloud: those two transforms cancel geometrically. It still controls the
grid's cell counts and grid-sized marks. Select Truncate to zoom into a mapped
value window, or turn Fit off to change its occupied extent.

## Natural defaults

Each unset Start, End, or Step is automatic. The menu shows resolved values;
Reset Range restores automatic bounds/step, Scale mode, and Fit on.

- Direct byte-value mappings have 256 natural levels.
- Hilbert coordinates use their curve's power-of-two side length.
- Generated coordinates and other expressions use balanced dimensions based on
  the population/sample budget and, in 2D, view aspect. Explicit Cartesian widths
  and heights constrain the remaining automatic dimension.
- Radius has a natural extent of 0–1, Angle/Azimuth 0–360°, and Inclination 0–180°.
  Their automatic steps divide that extent into the chosen natural levels.

Inputs to geometry remain normalized recipe outputs. Natural domains provide the
units for range controls; they do not change provider units, recipe arithmetic,
or the byte/spectrum sampling relationship. The CPU and shader recipe evaluators
retain their existing scalar/index precision contracts.

Counts and sampling grids are bounded to 65,536 cells per dimension. This does
not promise a complete dense volume allocation: the renderer evaluates sampled
points and retains buffers only for those points. Grid-sized marks have a minimum
raster footprint to keep subpixel cells visible; they are point marks, not solid
3D voxels.

## Configuration

```js
view.pointConfiguration = {
  ...view.pointConfiguration,
  space: 'cube',
  position: ['column', 'row', 'slice'],
  dimensions: {
    width:  { start: 0, end: 16, step: 1, mode: 'scale', fit: true },
    height: { start: 0, end: 8,  step: 1, mode: 'scale', fit: true },
    depth:  { start: 0, end: 4,  step: 1, mode: 'scale', fit: true }
  }
};
```

Each dimension defaults missing fields to automatic (`null`) bounds/step,
`mode: 'scale'`, and `fit: true`. Position mappings remain independent; changing
one neither resets a range nor silently changes other mappings.

## Hilbert and profiles

The Hilbert preset maps Width/Height to X/Y projections of a shared Hilbert
expression with exact Point Index input. Hilbert 3D uses the three projections of the cube curve, retaining byte
brightness/entropy shading and representative sampling. Select it from Preset →
Hilbert 3D. The same expressions can feed other channels; explicit 3D Hilbert X/Y/Z expressions remain available under Transform.
The app renders this preset through the general point pipeline. The older native
Hilbert painter remains available to low-level render clients/tests, not as an
alternative Layout setting.

Profiles now export version 3. Versions 1 and 2 are accepted: old arrangement
choices are materialized into ordinary coordinate mappings, and legacy grid
counts become ranges. Layout/Grid fields are removed from the normalized result.
Migration preserves configuration intent; older native/point sampling and edge
conventions do not guarantee identical raster pixels.
