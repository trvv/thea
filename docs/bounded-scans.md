# Bounded exact scans and tuple representatives

Tuple population discovery and histogram preparation can consume the root Blob
in bounded 64 KiB reads. Full scans carry tuple state or bounded overlapping
halos across chunk boundaries, so pairs
and triples that cross a page remain exact. Supplying an already prepared selected
byte buffer remains supported, without forcing an additional source read. A low
render sample count never changes which tuples exist or their exact counts.

`populationOffsets(job, bytes, cache, current, diagnostics)` is asynchronous. The
byte buffer is optional. It publishes `cache.population` only after its complete
scan, containing matching `keys` (Uint32) and representative `offsets` (Float64).
Offsets are selection-relative and exact JS-safe integers. First-encounter key
order determines the unsampled population ordinal, regardless of address policy.

`configuration.tupleRepresentative` is `first` by default, or `last`. Last changes
the address used by byte-local analysis, without changing tuple key/order/count
or silently selecting a different population under the same sample limit. It
does not mean an average address or an occurrence reduction. Every occurrence
still shares the selected tuple bytes; its surrounding entropy or neighbors may
differ. Profile/menu/provenance integration uses the same serialized parameter.

Scans yield real event-loop tasks between chunks, using `scheduler.yield` when
available, MessageChannel otherwise, and a timer fallback. Checks before and
after those yields can observe a newer revision or worker cancellation message;
an awaited already-completed Blob read alone does not guarantee this. The worker
must still receive and expose cancellation through its current-request predicate.

Histogram full scans build detached tables and publish atomically. Incremental
updates first read and accumulate detached deltas, checking cancellation after
yielding. One synchronous commit applies at most 65,536 changed tuple starts.
Larger changes use a detached full scan rather than a long mutation with yields
inside live cached state. Small-scroll incremental behavior and revision/changed
keys are preserved. Failed or superseded reads leave the previous usable table
and population snapshot intact.

An explicit `providerBudget` rejects operations before exceeding their planned
working storage. Byte/pair counter tables and tuple output arrays use exact typed
array sizes. Distinct triple maps, tuple maps and staged delta maps use a
conservative 96-byte-per-entry policy allowance (deltas also reserve a second
allowance for changed-key Set storage). That is an allocation policy estimate,
not an engine-specific measurement. Source input buffers are included when a
scan reads them; a supplied buffer belongs to its preparing provider's accounting.
No keys are dropped, no counts saturate to 32 bits, and no selected history is
silently shortened to satisfy a budget. Exact distinct storage still grows with
the number of unique tuples; streaming bounds input buffers rather than claiming
the result itself has constant memory.

`bun tests/population-streaming.js` compares streamed/buffered output with direct
maps, covers boundary-crossing and overlapping tuples, first/last ordering,
actual task-based cancellation, atomic histogram deltas, explicit budget failures
and truncated sources. Existing trigraph and scroll fixtures remain references.

Low-cardinality tuple discovery retains first/last/count entries and updates edge
changes for small overlapping moves. It repairs invalidated representatives with
bounded growing reads and merges changed first addresses into population order.
Above 4,096 distinct pair/triple keys, the lower-overhead full scan is retained.
Both paths preserve exact membership, order, counts and cancellation publication.
See [the performance follow-up](performance.md#performance-follow-up-shared-work-cancellation-and-density).
