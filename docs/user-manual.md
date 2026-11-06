# Thea user manual

Thea displays binary data as editable point visualizations. Use it to explore
byte values, repeated sequences, distributions, frequency content, candidate
text, numeric values and packed pixels. This manual describes the implemented
browser interface.

## Contents

- [Quick start](#quick-start)
- [Navigating the source](#navigating-the-source)
- [Choosing a preset](#choosing-a-preset)
- [What a point represents](#what-a-point-represents)
- [Position, spaces and dimensions](#position-spaces-and-dimensions)
- [Color, size, text and accumulation](#color-size-text-and-accumulation)
- [Inspecting points and finding occurrences](#inspecting-points-and-finding-occurrences)
- [Editing factors and calculations](#editing-factors-and-calculations)
- [Available analyses](#available-analyses)
- [Comparing two views](#comparing-two-views)
- [Saving, loading and sharing presets](#saving-loading-and-sharing-presets)
- [Bookmarks and source metadata](#bookmarks-and-source-metadata)
- [Training and using references](#training-and-using-references)
- [Performance controls](#performance-controls)
- [Worked examples](#worked-examples)
- [Troubleshooting](#troubleshooting)

## Quick start

1. Serve the repository over HTTP. For a local checkout, run
   `python3 -m http.server 8000` from the repository root and open
   `http://localhost:8000/`.
2. Right-click the visualization and choose **Advanced → Open File** to open a
   local binary. This replaces the current source.
3. Choose **Preset → Load → Linear** for an address-ordered view, or another
   preset from the same Load submenu.
4. Use the overview bars on the right to narrow the displayed source interval.
   Scroll to move through it.
5. Left-click a visible point to inspect it. Expand the collapsed sections to
   see its source bytes, calculations and rendered attributes. Press **Escape**
   to dismiss the inspector.
6. Customize position or appearance through the context menu. Use
   **Preset → Save As** to keep the resulting settings.

A URL can also supply the source: for example,
`http://localhost:8000/#examples/sample.bin`. The fragment is a URL relative to
that page. Without a fragment, Thea tries `./examples/cat`; the ignored examples
folder may not contain that file in a fresh checkout. A failed URL load is
reported in the browser console; you can still use **Advanced → Open File**.
Remote URLs require the remote server to permit browser access. URL loading
fetches the complete file before displaying it.

The interface is mainly a right-click menu. In nested menus, use the mouse or
arrow keys; Enter opens or activates an item, and Escape closes a submenu or
menu. Numeric fields accept typed values.

## Navigating the source

### Overview bars

There are two nested bars by default. Each grayscale bar summarizes the bytes
in its feeding scope; each displayed pixel is an average byte value, not an
entropy measurement. The yellow selector identifies the interval passed to the
next narrower bar or the visualization.

The widest bar is farthest right. The narrowest bar sits beside the view. Moving
an outer selector changes the scope available to the inner selectors.

- **Left-drag the selector body:** move its interval.
- **Drag its top edge:** resize while holding the bottom end fixed.
- **Drag its bottom edge:** resize while holding the start fixed.
- **Click outside the selector:** seek to that location, then drag if desired.
- **Mouse wheel:** move through the source by visualization rows. Over a bar,
  move that bar's selector within its feeding scope.
- **Middle-drag a bar:** velocity-based movement; distance from the initial click
  controls speed. Starting at a selector edge resizes that edge instead.
- **Middle-click and release without dragging:** latch velocity scrolling. Move
  the pointer to control it; click again, press Escape or leave window focus to
  stop it.

**Advanced → Bars** changes the bar count. **Zero** displays the complete source;
there is no hidden narrowed interval to scroll through in that mode.

### Keyboard movement

Focus the view by clicking empty space, or dismiss its point inspector with
Escape. Clicking a bar focuses that bar.

| Key | In the visualization | In a focused bar |
| --- | --- | --- |
| Left / Right | Move one byte backward/forward | Move one byte backward/forward |
| Up / Down | Move one navigation row | Move one byte backward/forward |
| Page Up / Page Down | Move by the displayed interval's length | Move by the selector's length |
| Home / End | Seek to the beginning/end allowed by the feeding scope | Seek to the beginning/end of the bar's scope |

Rows follow the configured grid; packed-pixel navigation accounts for record
stride. Movement clamps to valid source bounds. Menus and inspector controls
handle their own keyboard input.

### Rotating 3D views

Left-drag inside a Cube, Cylinder or Sphere view to rotate it. A stationary click
still inspects a point. **Camera → Reset Rotation** restores the default camera.
Changing the camera does not change the selected source bytes.

## Choosing a preset

All built-ins are under **Preset → Load**. They are editable starting
configurations: position, population, color and calculations can be changed
independently afterward.

| Preset | What it shows |
| --- | --- |
| Linear | Byte samples placed in address order along a generated grid. |
| Hilbert / Hilbert 3D | Address indices folded through a 2D/3D Hilbert curve. |
| H-Curve | Address indices folded through an alternative, 2D recursive traversal. |
| Morton / Morton 3D | Address indices arranged by interleaving coordinate bits. |
| Digraph | Distinct adjacent byte pairs positioned by their values. |
| Trigraph | Distinct adjacent byte triples positioned in 3D by their values. |
| DFT | One-sided frequency-bin points from a transform of the selected bytes. |
| Byte Frequency | Observed byte symbols in a 16×16 table, with occurrence-based brightness and hex text. |
| Packed Pixels → format | Complete byte groups interpreted as grayscale or RGB/alpha pixels. |

Hilbert keeps successive addresses in neighboring curve cells. Morton can jump
between blocks. H-Curve uses a different folding pattern. Nearby screen cells
are not guaranteed to be nearby source addresses; inspect a point when the
address matters.

HSL-based presets normally use local entropy for hue. Packed Pixels uses its
actual decoded RGB channels. **Points → Reset** resets appearance; loading a
built-in preset restores that preset's settings.

## What a point represents

**Population** controls which members produce points. Changing a color or
position factor does not change population.

| Population | Members |
| --- | --- |
| Bytes | Samples spanning the selected source interval. A sample may summarize several bytes. |
| Symbols | One member for each byte value actually present, sorted by byte value. |
| Pairs | One member per distinct complete adjacent two-byte sequence. |
| Triples | One member per distinct complete adjacent three-byte sequence. |
| Bins | The one-sided DFT bins: `floor(selected length / 2) + 1` for a nonempty interval. |
| Records | Complete spans at a configured byte origin and stride. |

Pair/triple order is first encounter in the selected interval. **Advanced →
Tuple Representative** chooses First or Last occurrence for byte-local lookups
on Pairs, Triples and Symbols. Membership and counts stay the same; the
surrounding bytes used for entropy or numeric interpretations can differ.
Absent symbols do not acquire a fabricated point or address.

A bin's spectral value comes from its frequency index. Byte-local factors on
that bin use a proportional byte correspondence, shown separately in inspection.
A frequency bin depends on the whole transform interval and has no unique
originating byte address.

### Sampling versus selected bytes

The default **Advanced → Sample Limit** is 262,144. Rendering may use fewer
members because of the viewport's sample grid or the available population.
Reducing this limit does not shorten the selected byte interval: exact counts
and global transforms still analyze that interval.

Downsampled byte samples can average their byte values and entropy. Text and
representative sampling use actual bytes. Curve presets use representative
sampling. The inspector distinguishes an averaged interval from a single byte.
The sampling policy is also part of the profile JSON.

## Position, spaces and dimensions

**Space** chooses Square, Circle, Cube, Cylinder or Sphere. **Position** then
shows that space's active axes:

| Space | Axes |
| --- | --- |
| Square | Width, Height |
| Cube | Width, Height, Depth |
| Circle | Radius, Angle |
| Cylinder | Radius, Angle, Height |
| Sphere | Radius, Azimuth, Inclination |

Under each axis, **Factor** chooses its calculation. Column, Row and Slice are
generated grid coordinates. Byte Value, entropy, spectral values and arbitrary
recipes can also provide position. The same sources can drive appearance.

Each axis has **Start**, **End**, **Step**, **Range Mode**, **Fit**, **Reset Range**
and **Invert**. Angles use degrees. A range is end-exclusive for grid cell counts:
Width 0–16 with Step 1 creates 16 cells. Grid order advances through width, then
height, then depth. Width 16 × Height 8 × Depth 4 gives 512 grid cells.

Both Range Mode and Fit are independent per axis. Defaults are **Scale** and
**Fit enabled**, including radial axes.

| Settings | Effect |
| --- | --- |
| Scale + Fit | Map the full input into the chosen range, then fit that range across the axis. Grid resolution can change while normalized positions stay the same. |
| Scale, Fit off | Map the full input into the chosen physical extent. |
| Truncate + Fit | Keep points within a natural-domain window and expand the surviving window across the axis. |
| Truncate, Fit off | Keep points within the window at their natural positions. |

For example, an angular range of 0–90° with Scale and Fit off occupies a
quarter-circle. Fit on expands that range around the full circle. Truncate
keeps only the original values in that quarter, rather than mapping every value
into it.

**Why did changing a range not move the points?** With Scale and Fit both on,
those transforms can cancel geometrically. Cell counts and grid footprints can
still change. Use Truncate to select a value window, or disable Fit to change
its occupied extent.

Automatic bounds depend on the axis and input: direct bytes have 256 natural
levels, curves use power-of-two sides, and generated dimensions balance the
population. **Reset Range** restores automatic values. Position/range edits
preserve the selected source interval; hiding points does not remove their bytes
from a histogram or DFT. There is no separate Layout control overriding position.

See [dimension details](dimensions.md) for boundaries and examples.

## Color, size, text and accumulation

Under **Points**, choose **Color Space → HSL** for Hue/Saturation/Lightness or
**RGB** for Red/Green/Blue. Opacity and Size remain independent. Each channel's
submenu edits its factor or calculation. **Shape** chooses Square or Circle.

Display channels use normalized values from zero to one. Read Byte, counts,
match distances and some statistical outputs use raw units inside a calculation;
normalize them before using them as a channel. Otherwise the display can clamp
most values to the same result. Inspection retains the contributing raw values.

### Local entropy

**Points → Hue → Source → Local Entropy** selects local entropy as hue.
**Points → Hue → Window** changes the neighborhood from 1 to 4096 bytes;
the default is 32. Other channels can use their own entropy calculations/windows.

Entropy describes the distribution of byte values in the neighborhood. A
constant neighborhood has low entropy; a varied distribution has higher entropy.
It does not by itself identify encryption, compression or a file type. Entropy
neighborhoods can extend beyond the selected interval, clipped at source edges.

### Footprint

**Advanced → Footprint** controls a mark's screen coverage:

- **Grid:** size marks from their configured cells, subject to a minimum visible
  footprint. This is useful for grids and packed pixels.
- **Point:** use particle-sized marks. This is useful for point clouds.

Footprint does not rearrange coordinates. **Points → Size** scales the chosen
footprint; 3D marks also change apparent size with perspective.

### Character and hex overlays

**Points → Text** chooses None, Character or Hex. Character enables a top-level
**Character** submenu with ASCII, ASCII + Overbar, CP437 and Latin-1 encodings,
plus Blank Spaces and Blank Nulls switches.

These are byte glyph overlays. The inspector's multibyte interpretation is a
separate feature; selecting Character does not decode the whole view as UTF-8.

### Screen accumulation

Enable **Points → Accumulation → Enabled** to display overlap density rather
than ordinary ordered point blending.

- **Depth → All Contributions:** include covered contributions behind other marks;
  this is the default.
- **Depth → Front Layer:** use the nearest covering contribution at each coverage
  probe.
- **Reference → Percentile:** choose a reference from occupied screen pixels.
  Percentile 0.99 is the default.
- **Reference → Fixed:** use Reference Value. This helps keep exposure comparable
  between views or camera positions.
- **Exposure:** adjust brightness relative to the reference.
- **Weight by Opacity:** include each mark's opacity in its weight; otherwise a
  fully covered visible mark contributes weight one.
- **Memory Budget (MiB):** cap density raster storage. The default is 256 MiB;
  zero removes this cap.

Density depends on camera, mark size, sampling and overlap. It is different from
an exact source occurrence count. Accumulation currently rasterizes on CPU even
when Backend is WebGL. See [density](density.md) for the exact weighting rules.

## Inspecting points and finding occurrences

Left-click a visible mark. All inspector sections start collapsed. Expand only
what you need:

- **Point/source information:** population, source offset, byte/tuple/record or bin.
- **Position and appearance traits:** contributing calculations and their results.
- **Rendering:** stored/projected coordinates, RGBA, size, footprint and camera.
- **Occurrence/context information:** bounded surrounding bytes and navigation
  when the point has a concrete byte pattern.

Bytes show decimal and hex, plus an ASCII representation when applicable.
For example, `65 (0x41, ASCII "A")`; a non-ASCII byte such as 255 shows
`255 (0xFF)` with no character label. Strict local UTF-8, UTF-16 and UTF-32
candidates and a bounded UTF-8 grapheme preview appear when available. These are
plausible local interpretations, not a declaration of the file's encoding.

Averaged samples identify their source interval and mean. Tuples identify their
chosen representative. Bins identify their coefficients and transform scope,
with byte correspondence separate. Mixed recipes expose the different inputs
used for each trait. In accumulation mode, Rendering also explains the pixel's
aggregate and a bounded sample of its contributors.

Inspection picks the frontmost visible covering mark. Clicking empty space
closes the popup. Escape dismisses it and returns focus to the view. A new
presented frame closes stale inspection information.

### Previous and next occurrences

For a byte, tuple or complete supported record pattern, expand the occurrence
section and use **Previous** or **Next**. The existing search looks for that
literal byte pattern inside the selected interval, supports overlapping matches,
and wraps around its boundaries. Choosing an occurrence updates its byte context
and requests navigation to its source offset.

These controls search the inspected pattern; there is no separate text/hex query
field in this interface. Bin coefficients do not offer pattern-occurrence
navigation. The normal standalone page follows navigation requests; an embedded
host can handle them differently. Redraws can close the popup, so inspect again
if needed.

See [inspection](inspection.md) for provenance details.

## Editing factors and calculations

Position and appearance submenus use the same expression editor:

- **Source:** choose a primitive, saved factor, Offset, Length, Point Index,
  Point Count or Constant.
- **Transform:** wrap the current expression in arithmetic, a lookup, a curve
  or an analysis.
- **Input / Operand / Offset:** edit nested arguments. Reopen the relevant
  submenu after applying a transform to see its parameters.
- **Remove Last Transform:** unwrap the outer operation.
- **Save Factor:** save the expression as a named reusable factor.

**Factors → New Factor** creates a named factor. Existing factors can be edited,
renamed or deleted there. Renaming updates references. Deleting a factor still
used by another calculation is rejected. Saved factors belong to the view's
profile and travel with its presets.

### Addresses and normalization

**Byte Value** is a normalized value, while **Offset** is an exact byte index
relative to the current selected interval. **Position** is the corresponding
normalized position. Point Index/Count refer to the unsampled population; for
Bins they are bin index/count.

Read Byte, Read Number, Local Entropy and Statistical Analysis take the current
expression as their address input. To analyze a point's normal byte address,
choose **Source → Offset** before adding such a transform. Using Byte Value as
that address instead performs a value-based lookup near the selection's start.
That can be useful, but it measures something different.

**Transform → Normalize** exposes Minimum and Maximum. For example, a raw byte
read needs bounds 0 and 255; an eight-bit population count needs 0 and 8.
Bit, Byte XOR and Population Count operate on raw byte-width values. Scale a
normalized Byte Value by 255 first when applying those operations to that value.

**Advanced → Undo / Redo** covers menu-driven profile edits for the chosen pane.
It does not restore source files, navigation ranges, bar count or deleted library
entries. **Advanced → Edit Profile JSON** edits a complete validated profile;
canceling or entering invalid data leaves the current profile intact.

## Available analyses

To add one at a mark's byte address, choose the trait's **Source → Offset**, then
**Transform → Statistical Analysis → analysis name**. The trait submenu then
contains Projection and the parameters relevant to that family. An outer
Normalize transform moves those controls under its nested Input.

| Analysis menu item | What it measures | Important controls/interpretation |
| --- | --- | --- |
| Conditional Probability | Probability or surprise of a byte given its predecessor. | Projection selects Probability, Surprise or Valid; Smoothing adjusts the model. Trained on the selected interval, including the scored data. Raw surprise is in bits. |
| Lag Comparison | Equality, mean absolute difference or mutual information between bytes separated by a lag. | Lag and Window; Window 0 uses the whole selected interval. Mutual information is raw bits, not a significance score. |
| Distribution Change | Difference between byte distributions on either side of an address. | Window, Gap and Projection: Total Variation or Jensen–Shannon Divergence, both bounded 0–1. |
| Bit Statistics | Fraction set, entropy or count for a particular bit. | Bit 0 is least significant; Bit 7 is most significant. Window controls the neighborhood. Constant-zero and constant-one bits both have zero entropy but different bias. |
| Repetition Distance | Nearest earlier exact four-byte match within a history. | History, Overlap and Maximum Match Length. Extension follows that chosen candidate; Distance and Match Length are raw byte counts. |
| Local Spectral Energy | Energy in a frequency band of a local frame. | Window, Hop, Origin, Taper, Preprocessing, Edges, Include DC and Band Minimum/Maximum. Frequencies are cycles/byte, 0–0.5. Band Energy is a fraction; Band/Total Power use raw units. |
| Occurrence Statistics | Exact count, probability or mapped exposure for byte/pair/triple values. | Tuple Width, Projection, Reference, Percentile, Compression and Exposure. Counts describe the selected source, independently of displayed overlap. |
| Occurrence Mean Entropy | Entropy reduced across actual occurrences of a pair/triple. | Tuple Width, Window and Projection: Mean Entropy, Entropy Sum, Count or Valid. It is different from entropy at one representative or at an averaged address. |
| Text Interpretation | UTF-8/16/32 code point, encoded length, byte index or validity at an address. | Encoding and Origin. Code Point is normalized; raw length/index outputs need explicit display scaling. |
| Reference Resemblance | Surprise or coverage relative to a saved byte/pair model. | Use the References convenience actions described below to select a model, then edit its Window and mapping. |

Most of these analyses use the selected interval as their scope. Boundary or
missing-context cases have a Valid projection. A scalar zero alone may mean
unavailable input rather than a measured zero; inspection explains which.

Other transforms include:

- **Read Number:** 16/32/64-bit signed/unsigned integers and 32/64-bit floats,
  with byte order, output projection and normalization controls. Incomplete
  spans are unavailable. Exact 64-bit values remain visible in inspection.
- **Available Span:** whether a complete requested byte span exists.
- **DFT Phase / DFT Frequency / DFT Amplitude:** sample global spectral values
  using an explicit normalized input; the recipe exposes nearest or complex
  interpolation.
- **Hilbert X / Hilbert Y, Hilbert 3D, H-Curve and Morton:** turn an explicit
  input into curve coordinates; Component and Order select a projection and
  resolution. Order zero is automatic.
- **Bit / Byte XOR / Population Count:** byte-width bit operations.

For full parameter definitions, see [statistical analyses](statistical-analyses.md),
[repetition/local spectra](nonlocal-analyses.md), [numeric recipes](recipes.md#complete-spans-and-numeric-interpretations)
and [text interpretations](text-interpretations.md).

## Comparing two views

Enable **Advanced → Comparison View** to create a second pane. It initially
copies the primary pane's profile. Right-click the pane you want to edit or load
a preset into; the other pane keeps its own configuration and camera.

Both panes follow the same source interval. Editing comparison geometry does
not resize that shared interval. Each pane has its own profile undo history.
Disable Comparison View to remove the second pane. Saving a preset captures the
chosen pane's profile and shared bar count, not the two-pane arrangement.

## Saving, loading and sharing presets

| Action under Preset | Result |
| --- | --- |
| Save As | Save the current pane's settings and bar count under a new name. |
| Load → Saved → name | Restore a saved entry. |
| Manage → name → Update | Explicitly overwrite that entry with the current settings. |
| Manage → name → Duplicate | Copy its stored settings under another name. |
| Manage → name → Rename / Delete | Manage the stored entry; deleting it leaves the displayed view usable. |
| Copy JSON | Copy the current settings, including unsaved edits. |
| Manage → name → Copy JSON | Copy that entry's stored settings. |
| Import JSON / Import File | Validate imported settings, save them under a chosen name and load them. |
| Export File | Download the current settings as JSON. |

Presets contain population, position/dimensions, appearance, named factors, text,
camera and execution settings, plus bar count. They do not contain source bytes,
source URLs, current ranges, comparison arrangements, source metadata or model
artifacts. Export reference artifacts separately when sharing a preset that uses
them.

The browser library survives refresh, and the last chosen entry is remembered.
Edits do not update a saved entry automatically: use Update or Save As. A remembered
built-in restores that built-in's defaults, not its unsaved edits. Local files
must be reopened after refresh; a preset does not reopen them.

Storage belongs to the browser origin, including the port. Another browser,
private session or different local-server port can have a separate library.
Export File provides a copy outside browser storage. Source/range bookmarks and
reference models use separate libraries.

## Bookmarks and source metadata

### Remembering a source range

Choose **Advanced → Bookmarks → Save Range** and enter a name. Under that name,
Load restores the exact byte range; Rename and Delete manage the bookmark.
Loading a bookmark creates a selection bar when necessary.

A bookmark is enabled only for a matching source identity. Local File identity
uses its name, size and last-modified metadata; URL identity uses its resolved URL,
size and available server validators. Reopen the matching local file before
loading its bookmark. These checks are practical identity hints, not a content
hash. Bookmarks of unnamed programmatic Blobs have session-only identity.

### Address mappings and annotations

**Advanced → Source Metadata** offers Import File, Edit JSON and Clear. Metadata
adds named source spans and file-offset-to-address mappings to inspection. It
does not rewrite bytes. Replacing the source clears its metadata in both panes.

A minimal example for a source at least 32 bytes long is:

```json
{
  "segments": [
    {
      "start": 0,
      "endExclusive": 32,
      "address": "0x140000000",
      "addressSpace": "main",
      "label": "header"
    }
  ],
  "annotations": [
    { "start": 0, "endExclusive": 4, "label": "candidate magic" }
  ]
}
```

Offsets are absolute source offsets; ends are exclusive. Wide addresses use
strings so they retain precision. Overlapping address spaces are allowed.
See [source navigation](source-navigation.md) for the full contract.

## Training and using references

1. Navigate to representative bytes you want to model.
2. Choose **Advanced → References → Train Selection → Bytes** or **Pairs** and
   name the model.
3. Navigate to the region to compare.
4. Under **Advanced → References → model name**, choose **Surprise Hue** or
   **Coverage Lightness**.
5. Inspect a point to see the scoring window, evidence and raw score. Edit the
   generated factor's Window or normalization if needed.

Surprise measures average negative log likelihood in bits per byte/pair.
Coverage is the fraction of scored grams seen during training. Neither is a
calibrated classification confidence. Training and scoring the same bytes gives
an in-sample description; comparing another region can be more informative.

The model menu supports Rename, Export File and Delete; References also offers
Import File. Models are separate from presets. A preset referencing a missing
model reports an error until that artifact is imported. See
[reference models](reference-models.md).

## Performance controls

These live under **Advanced** and are saved in presets.

| Control | When to use it |
| --- | --- |
| Sample Limit | Reduce displayed marks to make dense views lighter. Exact selected-scope statistics may still require substantial work. Default: 262,144. |
| Provider Budget (MiB) | Reject analysis operations whose estimated provider storage exceeds a chosen budget. Zero means no configured limit. This is not a total browser-memory cap. |
| Backend → CPU / WebGL | Choose point rasterization. CPU is the default; WebGL falls back on unsupported contexts or errors. |
| GPU Execution → Recipes | Opt into GPU evaluation for eligible recipe graphs, with CPU fallback. It can help complex graphs, while packing/readback can cost more for simple ones. Default: off. |
| GPU Execution → Projection | Opt into GPU projection. Readback made it slower on the software GPU tested here; leave it off unless it helps your workload. Default: off. |
| Adaptive Resolution | Permit temporary raster downscaling during sustained slow 3D interaction, restoring full resolution after idle. It does not reduce analysis scope or point count. Default: off. |

**Advanced → Record Stride / Record Origin / Record Width** appear for Records.
They are byte units: Origin is selection-relative, Stride is the distance between
record starts, and Width determines whether a record is complete. Packed Pixels
presets set suitable values. Pixel row width is controlled separately by the
position Width range. An incomplete final record is omitted.

For expensive analyses, narrow the source interval as well as lowering Sample
Limit. Each extra entropy window or requested analysis has its own preparation
cost. A comparison pane shares immutable analysis where possible but still
requires its own geometry and raster. Density has a separate memory budget under
Points → Accumulation.

See [performance](performance.md) and [GPU execution](gpu-execution.md) for measured
behavior and execution limits.

## Worked examples

### Compare address structure with byte triples

1. Load a source and choose **Preset → Load → Hilbert**.
2. Narrow an interesting region with the bars.
3. Enable **Advanced → Comparison View**.
4. Right-click the new pane and choose **Preset → Load → Trigraph**.
5. Rotate the triple cloud and inspect points. Move the bars to compare how both
   representations change over the same source region.

### Look for a repeated byte stride

1. In a Linear or Hilbert view, open **Points → Lightness → Source → Offset**.
2. Reopen Lightness and choose **Transform → Statistical Analysis → Lag Comparison**.
3. Reopen Lightness; choose Projection → Equality and set Lag to a candidate
   stride such as 4 or 16. Adjust Window to compare a local neighborhood.
4. Inspect bright and dark points to compare their valid pair counts and inputs.
5. Try another Lag manually and save a useful configuration with Save As.

### Try an RGB interpretation

1. Choose **Preset → Load → Packed Pixels → RGB24**.
2. Under **Position → Width**, use Start 0, Step 1 and End equal to a candidate
   image row width, such as 128. Keep Scale and Fit enabled.
3. Adjust the selected source start to a possible pixel-data offset. Use Record
   Origin for a byte offset within the selected interval.
4. If the source groups are farther apart than three bytes, adjust Record Stride.
5. Inspect several records to verify which bytes supplied Red, Green and Blue.
   Try BGR24 or an alpha format if appropriate.

A recognizable image is a useful hypothesis; the chosen interpretation still
needs to match the source's packing and dimensions.

### Show surprise without clipping every value

1. Choose a channel such as Lightness and set Source → Offset.
2. Add Transform → Statistical Analysis → Conditional Probability.
3. Set Projection → Surprise.
4. Add Transform → Normalize, then set Minimum 0 and Maximum 16.
5. Inspect a point to see uncapped surprise in bits. The display maps that range
   into 0–1; the raw measurement remains available.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Blank page or failed initial sample | Serve over HTTP. Use Advanced → Open File, or check the fragment URL and browser console. The default examples/cat may be absent. |
| Entire view uses almost one color | Check the selected factor, raw units, normalization and validity. Counts or distances mapped directly to a 0–1 channel can saturate. |
| A calculation always reads the first byte | Its address may be Byte Value or another normalized factor. Use Source → Offset when the intended input is the point's selection-relative address. |
| Range changes seem ineffective | Scale + Fit can preserve normalized positions. Try Truncate or disable Fit; also check whether the mapped coordinates use the generated grid. |
| Some bytes/pixels have no visible mark | Check Sample Limit, truncation, opacity, record completeness and empty curve cells. Exact counts and selected bytes are independent of visible marks. |
| Scrolling has no effect | Check Advanced → Bars. Zero bars deliberately displays the whole source. |
| Arrow keys do not navigate | Dismiss the inspector/menu and focus the view or a bar. Numeric inputs consume their own keys. |
| Preset or model disappeared on another page | Browser storage is origin-specific, including port. Import an exported JSON file on the new origin. |
| A preset reports a missing reference | Import its separate reference-model artifact. The preset stores the model ID. |
| Changing Sample Limit barely helps | The expensive part may be full-selection analysis. Narrow the selected interval or remove unneeded analysis/window calculations. |
| 3D view becomes blurry during motion | Disable Advanced → Adaptive Resolution. |
| WebGL is selected but execution uses CPU | Unsupported graphs, context loss, limits or accumulation can require CPU fallback. GPU Execution and raster Backend are separate choices. |

For deeper behavior, follow the linked feature guides. The [documentation index](README.md)
also contains the architecture and developer references.
