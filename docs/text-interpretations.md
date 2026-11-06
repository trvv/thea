# Local Unicode interpretations

`inspectEncodings(source, offset, current)` returns locally valid UTF-8,
UTF-16LE/BE and UTF-32LE/BE code-point candidates containing one addressed source
byte. It reads a single clipped neighborhood of at most seven bytes from the
root source, including context beyond a selected interval. A canceled/stale read
returns null; an available neighborhood with no valid candidates returns an
empty array. `inspectUtf8` retains its existing single-candidate API.

Pure `utf8At`, `utf16At` and `utf32At` helpers operate on an existing Uint8Array.
The latter two return candidate arrays and accept native-style `littleEndian`
booleans. They inspect every local byte alignment, so an odd-offset UTF-16 field
or nonzero-modulo-four UTF-32 field remains available. Multiple plausible
interpretations coexist; no file-wide encoding classifier or confidence gate is
used. Byte order is a parameter rather than an inference from the active view.

Each candidate reports its encoding, scalar/code point, displayed character,
exact absolute byte span and bytes, encoded length, and clicked byte's zero-based
position within that span. UTF-16/32 also report code-unit width, byte order,
alignment origin zero and the candidate start's remainder modulo unit width.
This describes the candidate, not an assertion that the whole source uses that
alignment. The actual start address remains explicit.

Decoding is strict: UTF-8 rejects overlong sequences, invalid continuation bytes,
surrogates and values beyond U+10FFFF. UTF-16 requires a correctly ordered
high/low surrogate pair and rejects isolated units. UTF-32 requires a scalar in
range excluding surrogates. Incomplete file-edge words are unavailable rather
than zero-filled. A real encoded U+FFFD remains a valid scalar; no decoder-error
replacement is synthesized. Noncharacters such as U+FFFF are valid scalar values.

Controls, separators and default-ignorable scalars use escapes, keeping invisible
or direction-changing interpretations explicit. Code points are not grapheme
clusters: combining sequences and emoji may involve several valid scalar spans.
No normalization or rewriting of source bytes occurs. BOM values can appear as
ordinary candidates; absence of a BOM does not suppress valid local input.

The inspection layer does not decode whole files or add per-point metadata.
Explicit `analysis` recipes with `family: "encoding"` separately request UTF-8/16/32
code point, encoded length, byte index and validity at an address. Their scope is
the selected interval, unlike root-context inspection. UTF-16/32 alignment has an
explicit selection-relative origin. Code Point is scalar/U+10FFFF; length and byte
index are raw integers requiring explicit display normalization. Invalid or
incomplete input has validity zero. Requested-address preparation does not add a
file-wide encoding classifier. Tuple and averaged sample origins must identify the
actual addressed byte; a bin's candidate belongs to its byte correspondence.

`bun tests/byte-interpretation.js` checks every clicked position of boundary
scalars and surrogate pairs, both endian orders, unaligned subarrays, invalid
and truncated input, native fatal-decoder reference fixtures, exact source spans,
shared bounded reads and stale replies.

## Bounded UTF-8 grapheme preview

`inspectUTF8Grapheme(source, offset, { radius = 64 }, current)` in
`src/analysis/grapheme-inspection.js` can group a locally valid UTF-8 run with native
`Intl.Segmenter`. It reads at most 255 root bytes (radius 3–127), retains every
contributing scalar and its original byte span, and reports a candidate cluster
without normalizing the source. Pure `utf8GraphemeAt` accepts an existing context
of at most 255 bytes. Missing Segmenter support leaves scalar inspection available.

The result explicitly records the read range, locally valid run and whether
either run boundary was clipped. It conservatively reports `complete: false`
unless both run ends are known from root boundaries or invalid UTF-8 bytes.
Grapheme segmentation can depend on preceding context, for example regional
indicator parity, so an internal-looking break is not proof that an arbitrary
bounded prefix was sufficient. This is a bounded preview rather than a promise
to identify arbitrarily long user-perceived characters. Invisible scalars remain
escaped, with the full code-point sequence available alongside the grouped span.

`bun tests/grapheme-inspection.js` covers combining marks, emoji joiners, flags,
CR/LF, exact byte maps, clipped context, no normalization, canceled replies and
missing-feature fallback.
