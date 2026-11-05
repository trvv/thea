# Selection and sampling

## Three independent sizes

Do not use these quantities interchangeably:

- **Selected bytes:** `offset` and `length` identify a half-open source interval
  `[offset, offset + length)`.
- **Sample layout:** `sampleLayout.columns/rows` determine traversal, sampling,
  row stepping, and the generated column/row factors.
- **Raster resolution:** a canvas's actual pixel dimensions. General points use
  display dimensions × device-pixel ratio × interaction-quality scale.

The native byte grid often renders into a small logical canvas stretched by CSS;
text uses a larger raster for readable glyphs. Native digraphs use a 256×256 value
space, DFTs use a phase/frequency image, and native trigraphs use the display
raster. General points have a native sample grid and a separate display raster.
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

Linear views snap selected lengths to a complete number of rows. The original
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
layout helpers using nonzero dimensions to avoid divisions by zero.

## Traversal and repeated samples

Linear downsampling can average a byte interval into one cell. Text uses an
actual representative byte so it never renders a glyph for a fractional average.
Hilbert traversal maps sample index to a cell in a power-of-two square. When the
square has more cells than bytes, sampling repeats some bytes to fill it. Repeated
colors therefore do not establish that the source itself was duplicated.

The overview bar is another separate aggregation: each pixel averages its exact
byte interval. At more pixels than bytes, empty intervals repeat the previous
average. The overview image is not a literal one-byte-per-pixel dump.

The **global Layout setting** affects generated column/row factors and sampling.
It will not move points whose positions only depend on byte values or spectrum
factors. Explicit recipe expressions `Hilbert(Position).X/Y` or
`Linear(Position).X/Y` provide independent coordinate factors usable in any
position or appearance channel. Their 2D vectors can also feed the axes of a 3D
space; there is no 3D Hilbert traversal implementation today.

## Presets and general points are not the same sample domain

The optimized paths predate the universal factor system:

| Path | What a displayed mark represents |
| --- | --- |
| Native linear/Hilbert | A representative byte or an averaged interval in a grid. |
| Native Digraph | An aggregated sliding adjacent-byte pair; both bytes overlap with neighboring pairs. |
| Native Trigraph | An aggregated sliding triple, with one packed 24-bit key per distinct tuple. |
| Native DFT | One or more one-sided spectrum bins accumulated into a phase/frequency pixel before log scaling. |
| General point renderer | A sampled byte offset carrying whichever primitive or derived factors the active mappings request. |

This distinction is intentional compatibility, not full convergence. A raw
Trigraph-like configuration can position many byte-offset samples at identical
coordinates; it does not automatically deduplicate them into one tuple particle.
Occurrence factors can still be computed over all selected bytes. Mapping those
counts into opacity while also drawing repeated samples is not identical to the
native tuple-aggregation opacity algorithm.

Likewise, a generic DFT factor attaches a spectrum value to a byte-offset sample.
The built-in uses `floor(sample * binCount / selectedLength)` for one-sided bin
selection. An explicit `spectrum` recipe instead samples at its normalized input,
which may itself be inverted, scaled, or derived from another factor. These are
sampling relationships, not claims that a frequency coefficient belongs to that
specific byte in the time-domain signal.

Switching from an optimized preset to raw geometry can therefore change density,
brightness normalization, and sampling even when the broad shape looks similar.
Preserve that distinction in tests and make any future unification explicit.
