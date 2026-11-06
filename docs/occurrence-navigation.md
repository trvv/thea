# Occurrence queries and byte context

`findOccurrences(source, options, current, diagnostics)` searches complete byte
patterns inside an absolute half-open source scope. Options include `pattern`
(1–32 byte values), `start`/`end`, exclusive `after` cursor, `direction` (`next`
or `previous`), `limit` (1–256) and `wrap` (off by default). Defaults cover the
whole source, start at the relevant edge and return at most 64 matches.

The result contains exact matched spans, pattern, scope, direction, next cursor,
whether returned matches crossed the wrap boundary and whether all candidates
were exhausted. A limited query stops at the requested match immediately;
`hasMore: null` means additional matches have not been searched, while false means
the requested search cycle was exhausted. A Next action should not scan ahead
just to count later matches. Paging resumes after the returned cursor. Wrapping
visits each candidate start at most once during one call, including the starting
match after the full cycle when it is the only occurrence.

Search reads at most 64 KiB plus pattern-width minus one per chunk, in either
direction. Adjacent chunks overlap the bytes needed to recognize boundary
matches, without duplicating candidate starts. Matching is exact, includes
overlapping patterns and never treats a truncated suffix as a successful match.
Real-task yields and currency checks prevent obsolete replies from updating
inspection. Input and result memory are bounded; rare/absent matches can still
require a full scope scan. This increment retains no whole-file occurrence index.

`inspectByteContext(source, offset, { radius = 16 }, current)` reads actual root
bytes around one address, clips at file edges and reports the absolute range,
anchor byte index and byte values. Radius is bounded to 127, so no more than 255
bytes are read. This supports a small source listing without adding a second file
editor or decoding an averaged numeric sample.

The query primitives do not change click or seek behavior on their own. UI
navigation must identify the requested source/span and reject replies after a
source or inspected-frame change. Byte/pair/triple patterns justify occurrence
search; a frequency coefficient has interval provenance rather than an intrinsic
byte pattern. The host bridge and popup actions are separate integration layers.

`bun tests/occurrences.js` covers forward/reverse/wrap/pagination, overlapping and
page-crossing matches, bounded early reads, direct-loop reference fixtures,+canceled queries, clipped context and invalid/truncated input.
