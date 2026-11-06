# Byte-value population and frequency table

Current delivery: The observed-symbol population and exact frequency table are implemented; unconditional absent-symbol cells remain a separate policy. See [implemented behavior](../byte-frequency.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Original proposal: The frequency provider already exists; this concerns which
marks exist and how their identities are inspected.

## What CantorDust implements

[ByteCloudVisualizer.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/ByteCloudVisualizer.java) puts the 256 possible
byte values in a 16-by-16 hex table and varies the text size and opacity by sampled
frequency. It searches occurrences when a cell is clicked. The source deliberately
excludes 00 and FF from its sampled scale and steps across the selected interval.
Those are upstream policy choices, not requirements for Thea.

Thea's byte population makes one mark per byte position. Pair/triple populations
make one mark per distinct observed tuple, but there is no corresponding population
for distinct byte values. A byteCount-colored linear plot repeats a value once per
occurrence; it is not a 256-cell distribution table.

## Proposed implementation

Introduce a byte-value population with an explicit policy: all 256 symbols or
only observed symbols. Use the symbol as a stable population key and a first
occurrence as its initial byte correspondence. Provide exact raw count and
probability independently of display normalization; the existing compressed
byteCount output cannot reconstruct raw frequencies accurately.

A recipe preset can then put x at the low nibble and y at the high nibble, with
frequency driving size/opacity. Consider supporting symbol text through the
existing text path without adding a dedicated cloud painter. Positions, hue and
other traits remain freely editable. The same population can form a histogram,
radial distribution or Hilbert arrangement.

Absent symbols in the all-values policy have count zero and no byte occurrence.
That missing correspondence must remain explicit: a position-based factor cannot
pretend the symbol lives at source offset zero. Symbol-derived values remain valid.
The simpler initial observed-only policy avoids this issue but should not hide the
future distinction in the population contract.

## Statistics and caveats

Count exactly using existing incremental histogram machinery. Do not let rendered
sample limits change counts, and do not silently exclude 00/FF. A configurable
scale excluding chosen symbols may improve contrast later, while retaining their
raw counts and visible presence. Linear, square-root and log count mappings must
be named separately from the statistics. Counts normalized by selection length
and counts normalized by peak frequency answer different questions.

Tuple correspondence policies apply here too: first occurrence, last occurrence
and occurrence aggregation are different operations. Inspection should show the
symbol in decimal/hex/ASCII, exact count, probability, current representative and
how to visit further occurrences once navigation is available.

## Order and acceptance

Implement raw histogram query output and representative policy first, then the
population and recipe preset. Memory remains bounded by the 256-symbol alphabet;
no selection-sized offsets array is needed. A first/last offset table can be
maintained during histogram construction, but incremental removal must recompute
an invalidated extremum rather than leaving a stale address.

Fixtures: empty input, only 00/FF, all symbols equally frequent, one rare symbol,
a selection shifted across occurrence boundaries, sampled versus unsampled
rendering with identical raw counts, and absent-symbol byte correspondence.
