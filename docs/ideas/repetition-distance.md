# Repetition distance and match length

Current delivery: Bounded exact nearest-block matching and chosen-candidate extension are implemented; global longest-match and approximate indexing remain separate. See [implemented behavior](../nonlocal-analyses.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Proposal: locate earlier occurrences of the byte block at an address. This would
add nonlocal structure that byte frequencies and local entropy do not capture.

## What the result means

For a block beginning at `i`, find an earlier matching block beginning at `j`.
Expose distance `i-j`, the matched byte length, validity, and the matching span.
Two regions can have similar byte histograms while only one contains substantial
copied material; an earlier match gives a concrete address to inspect.

Potential patterns include repeated records, duplicated sections, recurring
headers, padding runs, and dictionary-like reuse. This can inform exploration of
repetition without claiming to identify a compressor, deduplication scheme, or
file format.

## A deliberately small first algorithm

Start with exact fixed-width blocks, perhaps four bytes, and the nearest previous
matching start inside an explicitly bounded history. Four-byte keys can be packed
exactly into an unsigned 32-bit value. Larger blocks can use fingerprints plus
byte verification; a matching hash alone must never be reported as an exact match.

Define history and policy independently:

- Block width `K` determines the bytes being compared.
- History size `H` bounds how far back candidate starts may lie.
- Scope establishes the earliest allowed source address.
- Nearest/longest policy defines which candidate wins.
- An overlap setting determines whether the earlier block may overlap the current
  block or must end before it begins.

Overlapping blocks are useful for exposing constant runs: adjacent starts can
match. That is an analysis over an immutable source, not automatically a causal
compression model. If a compression-oriented interpretation is later wanted, its
history/copy semantics need their own precise definition.

For an initial nearest-match implementation, retain the most recent start for
each exact key. A later extension can compare longer ranges from that candidate,
up to a stated maximum length. This is the length of the chosen candidate's match;
it is not necessarily the longest match among all earlier starts. A global
longest-match search is a separate, more costly promise. For non-overlapping
matches, delay insertion until a block becomes eligible or retain enough previous
starts. Keeping only the newest overlapping start and rejecting it can miss an
older eligible match. Query before inserting the current start so a block cannot
match itself.

## Scope, output and missing matches

A selected-window history makes the analysis reproducible within the active
selection. Root-source history can reveal references to material outside it.
Both are useful, but switching between them changes meaning and must be explicit.
Always report the effective search range.

Distance zero is not a previous match. Use a separate validity result for the
first occurrence or for insufficient trailing bytes. Preserve the raw integer
distance and length in inspection. A visual mapping could use
`log2(1+distance)/log2(1+H)` for a bounded history, with length mapped separately.
Such normalization should not depend on the largest match found in the current
frame, which would recolor unchanged results when sampling changes.

Boundary clipping must not silently turn a requested four-byte comparison into a
one-byte match. Either require the complete block or expose partial-block search
as a separately named policy. Match lengths must not run past the end of either
source range.

## Useful combinations

- Keep byte-position coordinates and color by repetition distance, making nearby
  repeats and distant duplicated sections visually distinct.
- Map match length to opacity or size while hue describes distance.
- Position by entropy and match length to separate repeated high-entropy chunks
  from high-entropy chunks without a match in the chosen history.
- Color tuple points by the recurrence of a longer block at their representative
  occurrence, rather than replacing their exact tuple occurrence count.

Bin populations may consult this through an explicit byte address relationship;
a frequency coefficient itself has no intrinsic previous byte-block occurrence.
This preserves [population/provider independence](../pipeline.md).

## Indexing and performance

A linear scan with a key-to-most-recent-address Map is a simple starting point.
A bounded history needs expiration: removing an old start must not delete a key
whose most recent occurrence is newer. Page-local byte reads and a rolling key
can avoid rebuilding each block from scratch.

Index memory can still grow with the number of distinct blocks. A provider budget
must account for keys and addresses, not just rendered samples. Reducing the
configured history is a semantic change; arbitrary eviction that drops valid
matches is not an exact optimization. If an approximate capped search is offered,
its incompleteness must be identifiable in the result and profile.

Scanning a prefix may be necessary to answer a sparse request accurately. Persistent
checkpoints or block indexes can help later, but inspection should not secretly
build an unbounded whole-file index. Share work for identical source/history/key
policies, independently of point shape, camera and appearance.

## Inspection and validation

Show current and previous absolute ranges, compared bytes, distance, chosen match
length, history/scope, overlap policy, candidate-selection policy, and any search
cap. A future action could navigate to the matching span, but navigation UI is not
required for the first factor.

Test unique blocks, constant runs, alternating blocks, repeated high-entropy
chunks, overlap enabled/disabled, nearest-versus-older-longer candidates, expired
history, file/selection boundaries, and deliberate hash collisions for hashed
variants. Distances must remain exact beyond float32's adjacent-integer range.
The completion example should expose two identical chunks separated by unrelated
bytes and identify the actual prior address, with repeatable cached/fresh results.
