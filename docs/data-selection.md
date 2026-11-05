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

The native byte grid often renders into a small logical canvas stretched by CSS;
text uses a larger raster for readable glyphs. Native digraphs use a 256×256 value
space, DFTs use a phase/frequency image, and native trigraphs use the display
raster. General points have an independent sampling budget, placement grid, and display raster.
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

Optimized native linear views snap selected lengths to a complete number of rows. The original
unsnapped request is retained in `windowSize`/`requestedLength`; recalculating a
layout from an already-snapped length can change the chosen column count and
oscillate between grids.

A top-edge drag holds the old end fixed. `anchorEnd` follows that intent through
scope clamping and snapping. A bottom-edge drag holds the start fixed. Tests
cover this because making both edges follow the snapped start loses the user's
anchor and causes visible drift.

Whole-buffer mode is the exception to row-length snapping: every byte must stay
selected, including a trailing partial row. Rendering can sample the whole range
rather than dropping bytes merely to make its length divisible by columns.
An empty source remains a valid selection with length zero, despite intermediate
layout helpers using nonzero dimensions to avoid divisions by zero. General
point configurations keep partial rows/slices and preserve committed byte ranges
when layout or grid dimensions change.

## Traversal and repeated samples

Linear downsampling can average a byte interval into one cell. Text uses an
actual representative byte so it never renders a glyph for a fractional average.
Native Hilbert traversal maps sample index to a cell in a power-of-two square. When the
square has more cells than bytes, sampling repeats some bytes to fill it. Repeated
colors therefore do not establish that the source itself was duplicated.

The overview bar is another separate aggregation: each pixel averages its exact
byte interval. At more pixels than bytes, empty intervals repeat the previous
average. The overview image is not a literal one-byte-per-pixel dump.

## Layout and strides

Layout is an explicit arrangement: Mapped Coordinates uses stored factor recipes;
Linear 2D/3D and Hilbert 2D/3D generate point positions from population indices.
The same arrangement works with bytes, distinct tuples, and frequency bins. A 3D
layout chosen through the menu switches a 2D space to a cube. Existing 3D spaces
remain selected; users may independently map grid channels into radial spaces.

For a linear 3D grid with `C` columns and `R` rows per slice:

```text
column = index % C
row    = floor(index / C) % R
slice  = floor(index / (C * R))
```

The row stride is `C`; the slice stride is `C * R`. The number of slices is
`ceil(pointCount / (C * R))`. Channels are normalized cell centers. Grid → Columns
and Rows per Slice set these dimensions; 0 means automatic, and Reset restores
both to automatic. Automatic 3D dimensions form a roughly cubic volume. The last
row or slice can be partial; no selected bytes or points are discarded to fill it.

Column, Row, and Slice can also be used independently in mapped position or
appearance expressions. Mapped layouts generate a 3D linear grid in a 3D space,
or when rows per slice is explicitly set. Otherwise Slice is the sole plane's
center, 0.5. Hilbert arrangements choose their own power-of-two dimensions and do
not use the linear-grid stride overrides.

Sample limits do not renumber population indices or reflow the full grid. Layout
changes do not switch the byte sampling policy or reorder the input to FFT,
entropy, or occurrence providers. The sampling policy is an independent profile
field (`average` or `representative`); text always uses representative bytes.

Editing a position factor in the menu selects Mapped Coordinates. Switching back
to Mapped Coordinates without editing restores the stored manual mappings.
Explicit `Hilbert(Position).X/Y` and `Hilbert3D(Point Index).X/Y/Z` expressions
remain available for channel-specific transforms. Use `layout: 'mapped'` when
setting such position recipes programmatically.

## Point populations and mixed analyses

Native presets select byte samples, aggregated pairs/triples, or spectrum bins.
Their synthesized configuration preserves that population when an expression,
text overlay, or geometry edit promotes the view to general points.

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
requests all points. Native preset painters retain their specialized algorithms.

The committed byte range, navigation row steps, statistical provider scopes, and
adaptive raster size remain independent. Exact histograms and FFTs still analyze
the entire selection. Limiting points therefore bounds prepared mark storage and
sorting, not provider memory or the initial cost of discovering distinct tuples.

Native DFT accumulates bins into pixels before log scaling. Native opaque triple
rendering retains independent coverage/depth owners. General points use point
colors and back-to-front blending. Population preservation does not promise
pixel-identical color scaling or edge behavior across these painters.

Point Index and Point Count expose exact unsampled population ordinals and counts.
For frequency-bin points, they are the bin index and one-sided bin count. In
particular, a 3D Hilbert traversal can use the frequency-bin index directly rather
than the proportional compatibility byte address. The existing byte-factor
compatibility mapping is unchanged by the 3D coordinate operation.
