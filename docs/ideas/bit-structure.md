# Bit structure and bit changes

Idea: expose relationships that disappear when a byte is treated only as an
unsigned number. Single-bit extraction is already expressible with arithmetic
recipes; compact bit operations and rolling bit statistics would be additions.

Compact `bit`, `xor` and `popcount` operations are now implemented across the
compiler, CPU evaluator, menus and emitted shaders. See the
[recipe reference](../recipes.md). The rolling bias/entropy providers below
remain proposals. Bit inputs use raw byte units with explicit clamp/floor
conversion; normalization remains a separate expression.

## Why the representation matters

A numeric difference and a change in bits answer different questions. Moving
from `7F` to `80` changes the numeric value by one but flips all eight bits. Moving
from `00` to `80` changes the numeric value by 128 but flips only one bit.

Bit views could expose flags, packed masks, quantized channels, alignment, changing
low-order counters and regions with restricted bit patterns. Their interpretation
is still exploratory: a stable high bit does not by itself establish a signed
number or a format field.

## A small family of useful measurements

| Measurement      | Meaning                                                       | Scope                                 |
| ---------------- | ------------------------------------------------------------- | ------------------------------------- |
| Bit value        | Whether a selected bit is set.                                | One byte.                             |
| Population count | Number of set bits, optionally divided by eight.              | One byte.                             |
| Hamming change   | Number of differing bits between two bytes, divided by eight. | Two explicit byte addresses.          |
| Bit bias         | Fraction of bytes with a selected bit set.                    | An explicit local or selected window. |
| Bit entropy      | Binary entropy of that bit's observed zero/one distribution.  | The same explicit window.             |

Number bits from zero at the least significant bit through seven at the most
significant bit. The byte lookup, bit index and comparison lag should be recipe
parameters; there is no reason to add eight different built-in factors.

Bit bias and bit entropy are distinct. A bit that is always one has bias one and
entropy zero. A bit that is always zero has bias zero and the same entropy zero.
Keeping both lets hue describe which stable value occurs while opacity describes
how stable it is.

## What can be explored now

For raw byte `v` and bit number `b`, this expression uses existing operations:

```text
bit(v,b) = floor(v / 2^b) - 2 * floor(v / 2^(b+1))
```

Both terms must be combined before the display-channel clamp. Saving a raw
intermediate as a separately clamped display result would change the calculation.
An experiment can read `byte(offset)`, use constant powers of two, and map the
result directly to lightness or a position coordinate.

Compare several such recipes on the same source before introducing new operations.
A compact `bit`/population-count/XOR operation could then reduce expression size
and evaluation cost without creating a new analysis domain. Its CPU and emitted
shader semantics must agree on the byte-width mask; general JavaScript integer
bit operations must not accidentally introduce a different word width.

## Windows and unavailable inputs

A rolling bit-bias provider needs an address, requested window, selected bit and
scope. Root-source context is useful for continuity while navigating. Clip to
available bytes and report the actual sample count; do not count missing bytes as
zero bits unless an explicit padding mode requests that behavior.

For Hamming change, distinguish a valid `00` byte from an unavailable predecessor.
Existing byte lookups return zero outside the selection, which is useful and
reproducible but can create an artificial boundary change. A provider intended to
report measured bit changes should expose validity and both address ranges.

If a byte sample represents an average, do not compute a population count from a
rounded mean. Reading a representative byte and averaging per-byte population
counts are two different analyses. The same distinction applies when reducing
bit changes across tuple occurrences.

## Visualization examples

- Use a bit value for a cube coordinate and byte value/entropy for the other two.
- Keep a byte grid and shade by Hamming change at lag one; compare it with ordinary
  [numeric byte differences](byte-differences.md).
- Use bias for hue and bit entropy for lightness to show stable zero/one regions
  separately from changing bits.
- Compare Hamming change at a suspected record stride rather than only adjacent
  bytes, connecting this idea to [lag dependence](lag-dependence.md).

The current spaces have two or three position channels. An eight-bit analysis
does not require a new eight-dimensional rendering model: select projections or
combine them through ordinary scalar recipes.

## Cost and inspection

A 256-entry population-count table can serve any byte lookup. Extracting one bit
needs no statistical preparation. Hamming comparisons similarly operate on byte
values after addresses are resolved. Rolling bias can maintain eight counters
for a shared window rather than prepare eight independent scans.

Inspection should show raw bytes in hex/binary, bit numbering, mask or bit index,
comparison addresses/lag, changed-bit count, and normalization. Windowed results
also need the actual range, number of samples and counts of zero/one outcomes.
Global statistics should not be recomputed inside per-point arithmetic.

## First increment and checks

First try one-bit recipes and Hamming-change prototypes on constant runs,
`7F/80` transitions, single-bit toggles and synthetic flag fields. Validate all
256 byte values and relevant pairs against straightforward bit counting. Include
selection boundaries, unavailable comparisons, window clipping and integer byte
validation.

If the experiment is useful, add compact operations and one shared rolling
provider. The acceptance example should show a pattern that looks quite different
under numeric difference and Hamming change while inspection explains both results.
