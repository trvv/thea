# Occurrence navigation and bounded byte context

Current delivery: Bounded occurrence navigation, byte context, metadata mappings and cancellable address events are implemented; external tool transport is outside the clarified scope. See [implemented behavior](../source-navigation.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Status: proposal, extending existing point inspection rather than replacing it.

## What CantorDust implements

[OffsetJump.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/OffsetJump.java) distinguishes direct source offsets from
byte-pattern searches. Repeated tuple/byte clicks advance through matches and wrap
to the first one. [HexPanel.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/HexPanel.java) provides a standalone byte
listing painted only for visible rows. [Host.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/Host.java) delegates
file-offset navigation to either this listing or Ghidra.

Thea already reports the byte/tuple/bin inputs contributing to a point, and its
DataScroll host can seek. Tuple-based byte analyses currently use their first
occurrence. It lacks an explicit occurrence browser, bounded surrounding hex
listing and an external navigation event contract. These are useful when a rare
shape identifies a byte sequence but its source location is the next question.

## Initial implementation

Add an on-demand occurrence query for a selected byte/pair/triple key and an
explicit selected interval. Return first/previous/next addresses with pagination
or a bounded cursor. Keep the exact total optional until an existing count provider
can supply it cheaply. Do not perform a complete source scan on every repeated
click just to label the current occurrence.

Present navigation as explicit controls inside the inspected point's existing
popup. Repeated clicks currently inspect marks, so changing click meaning silently
would be surprising. Visiting an occurrence can request a seek and pin the same
key while the normal frame/picking freshness checks continue to apply.

Show a small hex/ASCII context around the chosen absolute offset, reading only
those bytes. This is not a second file editor. Missing file-edge bytes remain
missing; display source offsets separately from selection-relative addresses.
Add rows on demand if a full virtualized listing becomes useful later.

## Address and provenance contracts

A byte pattern can have many source occurrences; an averaged mark can represent
a range; a frequency bin depends on the complete transform interval. Only offer
navigation targets justified by that provenance. Do not invent a single frequency
bin address or search for a rendered floating-point coefficient in the file.

Dispatch a structured, cancellable navigation request containing source identity,
absolute byte span, selected occurrence/key and frame revision. A host can handle
it or let DataScroll perform its normal seek. Integration with Ghidra or another
tool is a later adapter; no required plugin/server is necessary for local use.

Executable addresses need mapped segments and possibly address-space identities,
not a universal baseAddress + offset formula. An unmapped file offset is a valid
byte location. Keep mapping metadata optional and source-specific.

## Cost, order and fixtures

Build this after representative occurrence policies and raw histogram queries.
Reuse existing counts; search pages lazily with overlap of patternWidth - 1,
bounded memory, cancellation and source revision checks. Reverse navigation and
wrap must work across page boundaries. Any cache must include source, selected
interval and pattern, with explicit ownership when the source changes.

Fixtures: overlapping repeated tuples, first/last/wrap, selection changes,
empty results, page-boundary matches, source replacement while searching, averaged
byte intervals, and bins offering interval context without a fabricated occurrence.
