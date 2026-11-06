# Multibyte encoding ideas

Proposal only. Multibyte decoding is not implemented.

The purpose is to show useful interpretations of the bytes under inspection.
False positives are acceptable, just as a printable ASCII byte does not establish
that a region is text. Local validity should be enough to show a match; do not
hide it behind a file-wide encoding classifier or a high confidence threshold.
Multiple interpretations can coexist.

## First increment: UTF-8 around a byte

For a clicked absolute byte offset, find a well-formed UTF-8 sequence containing
that byte, including when the click lands on a continuation byte. UTF-8 uses one
to four bytes per scalar value. Validate sequence length and continuation bytes,
reject overlong forms, surrogate values and values beyond U+10FFFF. Use the
[Unicode encoding-form definitions and well-formed sequence table](https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-3/)
rather than permissively decoding invalid input into a replacement glyph.

A bounded lookup can examine possible starts at the clicked offset and the three
preceding offsets, with enough following bytes to complete each candidate. A
small read covering up to three bytes on either side suffices. Read context from
the root Blob, including outside the selected interval, and clip at actual file
boundaries. Changing the selection should not turn the same underlying sequence
into a different character merely by cutting through it.

An inspection entry could contain:

- Encoding and validity.
- Code point, such as U+00E9, and its displayed glyph where available.
- Absolute half-open byte range and exact bytes in hex.
- Encoded length and the clicked byte's position within the sequence.
- Optional Unicode name/category and contextual evidence.

Keep the existing decimal/hex/ASCII byte representation alongside this entry.
Treat the result as an interpretation under UTF-8, without repeatedly warning
that binary data might also match. Invalid or file-truncated input should remain
inspectable as raw bytes; replacement decoding must not fabricate a successful
match. A genuine encoded U+FFFD is distinct from a decoder's error replacement.

## UTF-16 and UTF-32 interpretations

Add UTF-16LE/BE and UTF-32LE/BE after the byte/character provenance model works.
These forms have different code-unit sizes and byte-order requirements; the
[Unicode UTF/BOM FAQ](https://www.unicode.org/faq/utf_bom.html) describes their
relationships. They should be selectable interpretations, not competing modes
that replace access to other analyses.

| Interpretation      | Candidate handling                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTF-16LE / UTF-16BE | Examine both byte alignments. Decode a single ordinary code unit or a valid surrogate pair; either byte of either unit can be clicked. Preserve the selected alignment. |
| UTF-32LE / UTF-32BE | Examine all four byte alignments and retain scalar values in range, excluding surrogate values. Preserve the selected alignment.                                        |

UTF-16 surrogate pairs must have the correct high/low ordering; isolated
surrogates are not successful scalar decodes. The byte-order and surrogate rules
are described in [RFC 2781](https://www.rfc-editor.org/rfc/rfc2781.html).

An alignment is relative to a chosen origin. A field can begin at an odd absolute
file offset, so do not silently assume the entire file shares offset-zero
alignment. For inspection, trying the few local alternatives is inexpensive. A
future factor should let its recipe specify encoding, alignment and origin.

A BOM can supply evidence for a particular interpretation, but it must not be
required. A matching signature inside a binary region may be coincidental;
absence of one should not suppress locally valid matches. Neighboring valid
sequences, repeated alignment and character-category distributions can order
candidates without gating their visibility.

## Code points before grapheme clusters

Start with exact scalar/code-point spans. A displayed character can involve
multiple code points, so a code-point result should not claim to identify an
entire user-perceived character. Later grapheme inspection could group those
spans, retaining the original byte ranges and code points underneath. Do not
normalize or rewrite source bytes to produce a nicer-looking result.

Nonprinting characters need an unambiguous textual representation. Missing glyphs
must not be treated as invalid encoding. Character names and categories are
optional metadata, not prerequisites for displaying a valid scalar value.

## Fit with existing populations and recipes

For byte points, inspect the actual representative byte. For averaged samples,
decode the real source bytes in the identified interval; never interpret an
arithmetic mean as a character. A bounded preview or an explicitly selected byte
within the interval can avoid dumping an enormous decoded region into the popup.

Tuple points can inspect their current first-occurrence byte span. This does not
imply that every occurrence shares the same surrounding text. A frequency bin has
no intrinsic character: its byte correspondence may be inspected, but that result
must remain associated with the byte lookup rather than presented as the bin's
meaning.

Possible later recipe outputs include code point, encoded length, byte position
within a sequence, validity, and a configurable window's valid-sequence coverage.
These should remain freely mixable with entropy, counts and spectral factors on
any point population. Avoid one new built-in enum for every encoding/output
combination; a parameterized lookup could expose several projections.

## Implementation boundaries

Reuse the displayed-frame inspection path and source/offset contracts. Fetch a
small neighborhood on demand; do not decode the whole file or add per-point
metadata to every frame. Any caching should include source identity, absolute
range, encoding, alignment and policy.

If these interpretations later become shading factors, prepare only reachable
lookups and distinguish dense scanning from sparse sampled reads. Keep their
normalization and provenance explicit. Add persisted options only when a real
setting exists; this proposal requires no profile/schema changes.

## Fixtures for eventual implementation

| Bytes                              | Expected interpretation                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `41`                               | UTF-8 U+0041, also the existing ASCII `A`.                                    |
| `C3 A9`                            | UTF-8 U+00E9; either byte resolves to the same two-byte span.                 |
| `E2 82 AC`                         | UTF-8 U+20AC; each clicked byte resolves to the same span.                    |
| `F0 9F 98 80`                      | UTF-8 U+1F600; all four clicked positions retain their within-sequence index. |
| `65 CC 81`                         | Two code points; do not silently compose their bytes into another encoding.   |
| `C0 AF`, `ED A0 80`, `F4 90 80 80` | Reject as successful UTF-8 scalar interpretations.                            |
| `3D D8 00 DE`                      | UTF-16LE U+1F600; inspect both surrogate units and all four clicked bytes.    |
| `00 F6 01 00`                      | UTF-32LE U+1F600.                                                             |

Also cover isolated continuation bytes, truncated files, selection/page boundaries,
BOM and non-BOM cases, both byte orders, alternate alignments, controls, missing
font glyphs, averaged/tuple/bin provenance, stale replies and canceled reads.
