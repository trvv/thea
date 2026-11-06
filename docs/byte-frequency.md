# Byte-frequency table

`byteFrequencyTable({ representative = "first", text = true })` returns plain
`configuration`, `appearance` and `shaders` settings. Apply Linear, then assign
those three fields on the view; save the result through normal named presets.
It uses the general renderer and introduces no new painter or exclusive domain.

The `symbols` population contains each observed byte value once, ordered by
numeric byte value. Values `00` and `FF` are included when present. Absent values
have no mark and no fabricated source address. This first policy does not include
all 256 symbols unconditionally; that would require explicit unavailable-address
semantics for byte-local analyses on absent symbols.

Raw byte keys and exact Float64 occurrence counts come from a full selected-scope
scan. Sample limits bound rendered members, not those exact statistics. First or
last representative chooses a real selected occurrence for entropy and other
byte-local analyses. Symbol identity, occurrence count and table cell remain the
same when the representative changes; surrounding source context may differ.

The factory places low/high nibbles at cell centers of a fixed 16×16 grid, with
hex text enabled by default. Hue uses local entropy and lightness uses the
existing explicitly compressed byte-occurrence factor. Raw counts remain
available in provider metadata and inspection; this display mapping is not a
probability. Dimensions, space, position, shading, population and text remain
ordinary editable settings and serialize through the existing profile schema.

`recordPopulation(job)` is a separate allocation-free helper for complete strided
records. It returns count and exact selection-relative offsets from
`recordOrigin`, `recordStride` and `recordWidth`; overlapping records are allowed
when stride is smaller than width. A trailing partial record is excluded rather
than zero-padded. Packed pixels and numeric words can build configurations over
that population without altering symbol or tuple meaning.

`bun tests/byte-frequency.js` checks observed membership, numeric order, exact
counts, first/last origins, grid positions, hex labels, preset round trips and
complete record spans including large exact offsets.
