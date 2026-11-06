# Shared overview summaries

Overview bars share completed page-prefix sums, whole-page totals and in-flight
reads by root Blob identity inside one JavaScript execution context. Per-bar
frames, rasters and navigation remain independently owned. Engine-local numeric
source IDs are never global cache keys.

Each source retains at most 16 MiB of detailed prefix backing buffers and 4,096
whole-page total entries under separate LRU limits. Prefix storage includes the
extra leading zero, so at most 63 full 64 KiB pages fit. Totals remain useful after
detail eviction: whole-page contributions can be exact without rereading bytes.
Evicted partial-page detail is read again when needed; this is a bounded cache,
not a claim that every previously visited range stays resident. Map/object overhead
and transient read buffers are not included in the typed-buffer byte limit.

The service uses a WeakMap, allowing a source and its summaries to be collected
when its bars and frames disappear. Different sources have independent budgets;
the application does not yet enforce a single process-wide budget across live
unrelated Blob objects. `overviewSummaryStats(source)` exposes retained page bytes,
limits, total entries and pending page reads for developer checks.

Concurrent callers requesting the same absent page share one read and one immutable
summary. A consumer checks its own cancellation before publishing a frame; it
does not cancel a read that another consumer needs. Completed summaries can remain
useful after the initiating consumer becomes obsolete. Failed promises are removed
and a later request can retry. Read-byte metrics count a physical page read only
for its initiating call rather than charging every waiter for the same bytes.

The values still use exact half-open byte ranges and prefix sums. No source bytes
are dropped or approximated to meet a raster budget. File-truncated reads reject
instead of publishing an incomplete total. Empty subpixel bins retain the preceding
value, as before.

Separate workers own separate WeakMaps. A cloned source in another worker does
not share these summaries, and this increment introduces no cross-worker service,
SharedArrayBuffer or worker pool. Repeated snapshots inside one bar can reuse its
canonical immutable source when an engine's stable source ID survives Blob cloning.

`bun tests/overview-sharing.js` verifies concurrent sharing, exact clipped sums,
canceled waiters, retry, source identity, detail eviction and coarse-total reuse.
`bun tests/scroll-performance.js` retains the existing numerical navigation and
bounded-storage reference checks.
