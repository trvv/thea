# Selection and sampling

## Four independent sizes

Do not use these quantities interchangeably:

- **Selected bytes:** `offset` and `length` identify a half-open source interval
  `[offset, offset + length)`.
- **Sample budget:** `sampleLayout.columns/rows` and `sampleLimit` bound the
  number of general byte samples. These dimensions are independent of placement.
- **Point grid:** columns, rows, and slices determine placement coordinates and
  row/slice strides over the unsampled population.
- **Raster resolution:** a canvas's actual pixel dimensions. General points use
  display dimensions × device-pixel ratio × interaction-quality scale.

Every view has an independent sample budget, placement grid, and display raster.
Presets configure byte samples, distinct tuples or frequency bins without changing
that relationship. Text uses the same projected marks as other shading.
Changing canvas resolution must not change selected byte ranges or keyboard row
steps.

## Nested bars and coordinate systems

`DataScroll.levels` stores the widest scope first. Each level has:

- `base`: absolute start of its parent scope in the root Blob;
- `offset`: local start of its selected child window;
- `length`: committed selected child length;
- `requested`: unsnapped desired child length;
- `bar`: its `DataScrollBar`.

The bars appear in reverse DOM order: the narrowest bar is next to the view on the
left; the widest is farthest right. Do not reverse the model to match the DOM.

For example:

| Level | Parent scope in root coordinates | Local selection | Child scope in root coordinates |
| --- | --- | --- | --- |
| Outer | `[0, 10000)` | offset 2000, length 2000 | `[2000, 4000)` |
| Inner | `[2000, 4000)` | offset 300, length 512 | `[2300, 2812)` |

The view receives the root Blob plus offset 2300 and length 512. An inner bar
`seek(310)` is local; `DataScroll.seek(2310)` is absolute. Mixing these coordinate
systems is a common way to make the selector and displayed bytes disagree.

`updateLevels` walks parents before children, clamps every child to its feeding
scope, caches unchanged Blob slices, and passes the final absolute interval to
the view. A bar receives both its parent Blob and `{source: rootBlob, offset:
base}` so its overview can reuse root-source prefix-sum pages. Merely moving its
selector updates the cursor without recomputing the parent overview.

With zero bars, the view always receives the complete root Blob at offset zero.
Navigation cannot quietly create an invisible narrowed selection. Adding bars
restores actual selectable scopes.

## Requested length versus committed length

The requested length is retained separately from the committed interval because
scope boundaries can clamp it. Layout and raster resolution do not round selected
lengths to complete rows; partial rows/slices remain valid.

A top-edge drag holds the old end fixed. `anchorEnd` follows that intent through
scope clamping and snapping. A bottom-edge drag holds the start fixed. Tests
cover this because making both edges follow the snapped start loses the user's
anchor and causes visible drift.

Whole-buffer mode selects every byte, including trailing partial rows. An empty
source has length zero; nonzero helper dimensions only avoid divisions by zero.
Position and dimension edits preserve the committed byte interval.

## Traversal and repeated samples

Linear downsampling can average a byte interval into one cell. Text uses an
actual representative byte so it never renders a glyph for a fractional average.
The app’s Hilbert preset maps exact population indices into a power-of-two
square through coordinate expressions. Extra curve cells stay empty. Low-level
render jobs use exactly the same coordinates as the app preset.

The overview bar is another separate aggregation: each pixel averages its exact
byte interval. At more pixels than bytes, empty intervals repeat the previous
average. The overview image is not a literal one-byte-per-pixel dump.

## Dimensions and strides

Position mappings always determine coordinates. Column/Row/Slice are generated
from per-axis ranges and steps, and explicit Hilbert expressions transform point
indices. There is no global Layout override. See [dimensions](dimensions.md) for
Scale/Truncate, per-axis Fit (on by default), natural units, and range examples.

For width count `C` and height count `R`, generated coordinates advance along
width every point, height every `C` points, and depth every `C * R` points.
Scale uses the chosen ranges to form this grid; Truncate retains natural-grid
strides and selects a window. The two-dimensional path ignores depth in geometry.

Ranges, grid capacity, and the sample budget do not narrow the committed byte
selection. Statistics still use the full selected interval. Truncation only
filters prepared marks; it does not change histogram/FFT input. Sampling is
independent (`average` or `representative`), and text uses representative bytes.

## Point populations and mixed analyses

Presets select byte samples, distinct pairs/triples, or spectrum bins through
ordinary configuration. Expression, text and geometry edits use the same renderer
and preserve population unless it is explicitly changed.

`configuration.population` specifies what generates points; it does not restrict
which factors may be mixed. Tuple points use the first occurrence of their tuple
inside the selection for byte-offset analyses. Bin points use their exact bin for
built-in spectral factors and a corresponding byte offset for other analyses.
Explicit `spectrum(input)` recipes always use their own normalized input.

A byte point can therefore combine FFT, entropy, neighbors, and occurrence
statistics, and a tuple point can do the same. Changing population is an explicit
configuration/menu action, separate from choosing factors.

General point sampling defaults to a limit of 262,144. Byte points span the entire
selected interval; value/entropy samples average their intervals when `sampling`
is `average`. Text and the representative policy use actual bytes. Tuple/bin
populations are
uniformly subsampled in population order when they exceed the limit. Tuple order
is first occurrence, not sorted tuple key order. `sampleLimit: null` explicitly
requests all points.

The committed byte range, navigation row steps, statistical provider scopes, and
adaptive raster size remain independent. Exact histograms and FFTs still analyze
the entire selection. Limiting points therefore bounds prepared mark storage and
sorting, not provider memory or the initial cost of discovering distinct tuples.

Each point has its own color and footprint. Bins are not accumulated into an
intermediate image before shading; changing coordinates uses the original points.
Three-dimensional views use common back-to-front blending and coverage rules.

Point Index and Point Count expose exact unsampled population ordinals and counts.
For frequency-bin points, they are the bin index and one-sided bin count. In
particular, a 3D Hilbert traversal can use the frequency-bin index directly rather
than the proportional compatibility byte address. The existing byte-factor
compatibility mapping is unchanged by the 3D coordinate operation.
