# Shared-pipeline measurements

## Provider diagnostics

Set `diagnostics: true` on a view render job to return an additional developer
report from `executeRender`. `RenderEngine.onFrame` also receives it for local
and worker frames. This flag is execution-only and is not saved in presets or
shown on the page. Ordinary jobs omit the report.

```js
const result = await executeRender(
  canvas,
  { ...job, diagnostics: true },
  cache,
);
console.log(result.diagnostics);
```

The report separates source read calls/bytes/wait time; byte-window, entropy,
count, spectrum and tuple-population preparation/reuse; and the synchronous
sample visitor. `evaluation` includes recipe evaluation, factor filling, sample
reductions, coordinate/color mapping and the visitor callback, not just arithmetic
instructions. Providers are timed in coarse blocks rather than per mark. Provider
durations include their own reads, so do not add them to source wait time as if
they were disjoint. Compilation/allocation, transfer and browser composition are
not included in that visitor measurement.

`retained.typedArrayBytes` counts distinct backing buffers in known provider
caches, including the full backing allocation of a retained subarray. `buffers`
and `views` expose aliasing; `mapEntries` counts distinct retained Map entries,
not their engine-dependent byte overhead. This excludes prepared marks, rasters,
GPU allocations, object/Map overhead and transient FFT peak storage. It is not
process memory or a peak-allocation measurement. Old retained provider caches
remain counted even if the current graph no longer consults them.

Run a deterministic non-gating report with:

```sh
bun tests/provider-benchmark.js
```

It covers cold, repeated and appearance-edited frames, sparse selections at two
sizes, multiple entropy windows, random/repeated tuples, and radix-2/prime FFTs.
On this checkout, 256 representative marks with value/32-byte entropy retain
393,246 provider bytes for a 64 KiB selection, and 6,291,456 for a 1 MiB selection.
Warm frames issue no new reads. These counts establish the need for sparse
provider preparation; this increment measures the cost and does not eliminate it.
Default averaging needs its own exact strategy, rather than substituting one
representative byte. See [the implementation plan](ideas/PLAN.md).

Engine queue lifecycle counters, enqueue-to-composition latency, physical-GPU
measurements and overview summary accounting remain future instrumentation work.

## Dependency and upload reuse

Immutable color buffers now survive size/shape-only edits. Reduced recipe graphs
omit color-only providers for that edit; tests assert unchanged buffer identity,
zero provider work and exact fresh-path pixels, independently of preset names.

WebGL retains instance data while prepared appearance and projected state remain
unchanged. Repeated frames avoid both the instance loop and upload: 65,536 marks
avoid a repeated 2 MiB transfer. Camera/appearance changes invalidate the state;
an intervening CPU camera frame also forces a new upload. Chromium checks actual
upload counters and coverage parity. CPU projection, sorting and recipes remain
on CPU; no compositing/coverage change is implied.

## Earlier shared-renderer comparison

Measurements made during the removal of preset-specific painters, comparing
`e3a0727` with the replacement pipeline. These are Bun CPU timings with a canvas
double on the same machine, not browser/GPU throughput or universal thresholds.

Run equivalent configurations against another checkout:

```sh
bun tests/scroll-benchmark.js
bun tests/scroll-benchmark.js /absolute/path/to/older/checkout
```

The benchmark lives in the current checkout and imports the requested checkout's
renderer and configuration modules. It does not require the older checkout to
contain the new benchmark. Five frames warm each workload before recording the
median of fifteen steady frames.

The main fixture uses deterministic pseudorandom bytes, a 256 KiB selected interval,
65,536 byte-population marks, a 256×256 sampling budget, and a 512×384 output raster.
Square coordinates use Column/Row with grid footprints; cube coordinates use byte
value/next byte/byte +2 with point footprints. Both shade hue by byte value and
lightness by local entropy. Appearance edits alternate hue between value/next byte.
Scroll advances 32 bytes; camera changes yaw by 0.02 radians.

| Fixture / operation    | Previous shared renderer | Replacement | Approximate reduction |
| ---------------------- | -----------------------: | ----------: | --------------------: |
| Square scrolling       |                 55.55 ms |    26.25 ms |                   53% |
| Square appearance edit |                 39.33 ms |    13.48 ms |                   66% |
| Square repeated frame  |                 17.88 ms |     4.94 ms |                   72% |
| Cube scrolling         |                259.17 ms |    97.57 ms |                   62% |
| Cube appearance edit   |                217.68 ms |    15.60 ms |                   93% |
| Cube repeated frame    |                200.19 ms |     8.85 ms |                   96% |
| Cube camera motion     |                197.78 ms |    23.37 ms |                   88% |

These comparisons explicitly configure both renderers identically. They measure
shared-stage improvements, avoiding a comparison of the old gray tuple painter
against a new entropy-colored tuple population with different work and semantics.
Repeated runs fluctuate with JIT warmup and GC; cold timings are reported separately.

One important regression remains: the old tight, one-pixel-per-byte grid loop
could render a 256 KiB selection in roughly 6 ms in the former benchmark, whereas
the shared pipeline took roughly 54 ms for that dense case. It now prepares and
stores general geometry and marks and uses common coverage semantics. Do not
claim that removing specialized painters improves every workload. A future fused
regular-grid kernel should be selected by coordinate/appearance/coverage properties
and validated against the shared reference, rather than attached to Linear or
Hilbert preset names.

Stage timings now make that work easier to target. In the replacement benchmark,
appearance-only changes avoid projection and sorting entirely; scrolling still
pays preparation and, in 3D, depth sorting. The mark/raster buffers for the 65K
fixtures retain about 3.5 MiB, excluding source/provider arrays and plan/color
caches. Sparse entropy/byte preparation and incremental tuple representative
discovery remain useful ways to reduce full-selection work; camera projection on
GPU and dependency-specific color/size buffers are separate opportunities.

## Overlapping selections and exact depth ordering

Engine-local source and entropy pages now survive selection movement. Pages are
64 KiB, indexed by source identity, absolute address, entropy window and its
existing quantization contract. Entropy interiors use source-clipped halos;
selection-trained statistics keep their own selection keys. An LRU bounds retained
page buffers to 8 MiB per engine, reduced by the remaining byte/entropy provider
budget. Small sources and tight budgets retain the original dense path. Sparse
preparation releases this page cache. Diagnostics include retained page buffers.
This trades bounded duplicate page storage and page-sized cold reads for reuse;
selection-sized output arrays are still assembled, not eliminated. Separate workers
still own separate caches. FFTs and tuple scans are not made incremental by this.

3D depth ordering uses stable four-pass radix ordering of Float32 depth keys,
including equal depths, signed zero and infinities. Nonfinite NaN projections
retain the former comparison-sort behavior. The sorter retains two Uint32 scratch
arrays (8 bytes per allocated mark) and 1 KiB of counters. This is additional to
older benchmark mark/raster accounting. No depth approximation is introduced.

A same-machine CPU/canvas-double run with 65,536 marks measured cube camera frames
at approximately 11 ms versus the preceding 26 ms, with sorting around 1.3 ms
versus 16 ms. Cube scrolling measured 58 ms versus 80 ms and square scrolling
23 ms versus 31 ms. These are indicative non-gating runs, not browser or physical
GPU latency guarantees. `tests/performance-reuse.js` verifies ordering and page
reuse against independent full-source entropy calculations.

Density storage now follows the enabled options: 36 bytes/pixel for fixed-reference
all-contribution mode, plus 8 for percentile references and 1 for front ownership.
Unused buffers are released when switching options. At 1080p, fixed/all storage
is about 71 MiB; default percentile/all is about 87 MiB. Budgets use the same
option-dependent allocation estimate.

Adaptive resolution is now opt-in under Advanced → Adaptive Resolution, saved
with each preset. Missing settings in older profiles mean disabled. Normal 3D
interaction keeps full resolution; enabling the flag restores the existing
feedback controller and idle restoration. Point sampling remains independent.
