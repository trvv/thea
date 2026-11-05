# Point inspection

Left-click a mark to open its information popup. A 3D camera drag does not open
inspection; small pointer movement within four CSS pixels counts as a click.
Escape dismisses the popup and returns keyboard focus to the view. Clicking
outside uses native popover dismissal. Blank clicks dismiss without opening a
replacement. Source, configuration, camera, raster or presented-frame changes
invalidate the popup and pending inspection replies.

## What is shown

All sections, including the point metadata and calculation trees, start collapsed.
Actual byte fields and byte arrays show decimal, hex and ASCII representations.
ASCII control bytes use their standard names; bytes above 127 are marked non-ASCII.
Averaged numeric values are kept numeric rather than presented as characters.

The point summary identifies the population and exact unsampled ordinal. Byte
points include their absolute source offset and raw byte. Averaged byte samples
identify their full half-open source interval, sample count and mean rather than
claiming that one byte supplied the whole mark. Tuple points identify the tuple
and its first selected occurrence. Bin points identify the spectral bin separately
from its proportional byte correspondence.

Position and appearance traits each show their expression, normalized result,
and reachable calculation tree. The tree comes from the normal recipe evaluator,
including float32 rounding, exact index arithmetic, constants, arithmetic,
lookups, shared coordinate vectors and resolved named definitions. Position
traits include ranges, inversion and fitted coordinates. Appearance traits show
rendered hue/saturation/lightness/opacity/size, including defaults. Text includes
its byte source and encoding settings.

Provider descriptions include:

- Byte addresses and values, neighbor boundary-zero behavior, and averaged
  source intervals/means.
- Entropy window sizes, clipped absolute halo ranges, neighborhood bytes/counts,
  Shannon bits and normalization/quantization. Averaged entropy identifies the
  sampled interval and halo instead of emitting a potentially enormous list of
  overlapping windows.
- Occurrence tuples, exact selected-window counts, and count normalization.
- DFT bin indices, selection range/transform length, cycles per byte, Nyquist
  fraction, real/imaginary coefficients, stabilized phase, one-sided amplitude
  correction, peak amplitude and log normalization when those providers are used.
- Grid strides/dimensions and resolved Hilbert order/index.

The Rendering section contains actual stored coordinates, RGBA, mark size/shape,
footprint, raster size, projected bounds and camera settings. Large source
intervals are identified by range; global analysis does not dump the entire input
file into the popup.

## Picking and frame ownership

`hitPoint` uses the same shape, footprint, size, four sample probes and positive
opacity as the CPU/WebGL rasterizers. It searches reverse paint/depth order and
selects the frontmost covering mark. An overlapping pixel can contain multiple
contributors; inspection describes the selected mark, not a decomposition of the
final composited pixel. It does not select a nearby point outside its footprint.
DPR and adaptive raster scaling are accounted for when converting client clicks.

`RenderEngine.inspect(x, y)` accepts coordinates in the displayed canvas raster
and returns a point description or `null`. It targets `presentedJob`, even when a
newer job is pending. Replacement clicks, new presented frames, worker failure
and disconnect settle or invalidate pending inspection. Replies never update
render scheduling/calibration or present a bitmap.

Each engine permits one active worker inspection and one replaceable pending
inspection. Worker inspection messages are serialized with renders. Only the clicked point's
description crosses the thread boundary. `point-inspection.js` reuses the displayed
frame's prepared/projected data when available; an older snapshot can rebuild its
preparation/projection without rasterizing or replacing the visible canvas.
Inspection borrows immutable byte/entropy/spectrum buffers, while mutable
histograms and scratch remain independently owned.

The provider visitor supports a sample-ordinal interval, so tracing evaluates one
sample rather than every mark. Normal rendering does not construct provenance
objects or transfer a per-point metadata table. The optional evaluator trace is
used only during inspection; ordinary source-only graphs retain their direct
compiled evaluator. Exact providers may still require full-selection work if
needed data is no longer cached.

## Validation

`tests/point-inspection.js` covers byte origins, averages, entropy halos, spectra,
named/mixed recipes, tuple counts, frame/source replacement, mark coverage,
transparency, text and traced/evaluator parity. Engine tests cover local/worker
parity, displayed-versus-pending snapshots, stale replies and cancellation. The
real worker and browser suites exercise the protocol, actual click popups,
source/trait content, focus, Escape, frame changes, and worker cleanup.
