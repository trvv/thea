# Sparse byte and entropy preparation

Representative byte populations with statically addressed byte/entropy expressions
can prepare only contributing source ranges. This is an execution strategy, not
a new analysis domain, sampling mode or preset painter.

The planner resolves offset, length, point index/count and constant arithmetic
using the existing exact-index/float32 contracts. It merges the requested byte
spans and root-source entropy halos, reads completed ranges, and retains only
requested entropy results. Byte lookups remain selection-bounded; entropy can use
root context beyond selection. The 32-byte window keeps its byte quantization.
Inspection uses the same byte/range accessors, so its source descriptions do not
assume a full selected buffer exists.

The current sparse strategy is bounded to 16,384 samples, 65,536 planned requests,
and 16 MiB of source ranges. It is selected only above a 64 KiB selection and
when merged source ranges cover less than half the selection. This avoids
turning ordinary dense work into thousands of small reads. Other configurations
continue through the dense reference: averaged buckets, data-dependent lookup
addresses, numeric spans, tuple populations, exact counts and global spectra.
Their meaning does not change merely because sparse execution is ineligible.

Ranges are source/scope/request keyed in a single immutable completed cache entry.
Cancelled reads do not publish partial entries. Switching to sparse preparation
releases dense byte/entropy cache entries. Camera-only frames reuse prepared
marks; unchanged provider requests reuse their sparse ranges. Distinct new
requests currently rebuild ranges rather than maintaining a cross-job page LRU.

`diagnostics: true` reports source reads and retained backing buffers, including
sparse ranges and entropy Map entry counts. With 256 representative marks over
a 1 MiB selection, the 32-byte entropy benchmark reads and retains 8,176 source
bytes instead of retaining 6,291,456 provider typed-array bytes. There are 256
small reads; Map/object overhead is excluded from exact typed-array accounting.
A 64 KiB fixture deliberately retains the existing dense strategy.

Provider allocation budgets use conservative estimates for source ranges,
temporary entropy buffers and Map/object entries before reads. They are not a
claim of exact JavaScript heap accounting. Optional execution-only
`sparseProviders: false` on a render job selects the dense reference for debugging;
it is not a preset setting and does not change image semantics. Clear/rebuild the
preparation cache when comparing strategies on otherwise identical warm jobs.

`bun tests/sparse-providers.js` checks exact final pixels against the dense path,
odd/even windows, file/selection edges, shared halos, inspection, exact large
addresses, warm reuse, fallback semantics, budget rejection and cancellation.
