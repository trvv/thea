# Shared-pipeline measurements

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

| Fixture / operation | Previous shared renderer | Replacement | Approximate reduction |
| --- | ---: | ---: | ---: |
| Square scrolling | 55.55 ms | 26.25 ms | 53% |
| Square appearance edit | 39.33 ms | 13.48 ms | 66% |
| Square repeated frame | 17.88 ms | 4.94 ms | 72% |
| Cube scrolling | 259.17 ms | 97.57 ms | 62% |
| Cube appearance edit | 217.68 ms | 15.60 ms | 93% |
| Cube repeated frame | 200.19 ms | 8.85 ms | 96% |
| Cube camera motion | 197.78 ms | 23.37 ms | 88% |

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
