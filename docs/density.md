# Screen-space density

Points → Accumulation → Enabled switches the shared raster stage to density.
All Contributions is the default depth policy, as requested. Front Layer is an
independent flag. Every population, coordinate recipe and space uses the same
implementation; there is no density preset painter or domain restriction.

Each positive-opacity mark contributes its four-probe footprint coverage. By
default one fully covered mark has weight one. Weight by Opacity instead uses
rendered 8-bit opacity as an additional multiplier. Completely transparent marks
contribute nothing. Size, shape, camera and clipping keep their normal meaning.

All Contributions adds every overlap, including marks behind others. Front Layer
assigns each probe to its nearest positive-opacity covering mark in depth/paint
order. Different probes can have different owners. This is geometric ownership,
not recursive translucent blending; opacity weighting changes its weight rather
than allowing rear layers through it.

Color is the coverage-weighted RGB mean, scaled by
`min(1, log1p(exposure * count) / log1p(reference))`. Background is black.
Reference is fixed or a nearest-rank percentile of nonempty pixels (default 0.99).
Fixed references stabilize comparisons. Screen percentiles can change with camera,
footprint and raster size. Screen density is not selection-space tuple frequency;
sample limits still choose which marks exist.

Presets save all flags and parameters. Accumulation-only edits do not rebuild
geometry or color providers. Density rasterization currently uses CPU, including
when WebGL is requested; preparation keeps normal local/worker routing. No GPU
density parity or automatic acceleration is claimed.

Five Float64 arrays, probe ownership and image storage are reused, requiring
approximately 45 bytes per raster pixel. Density has a default 256 MiB budget;
Memory Budget (MiB) zero removes that dedicated cap. A configured provider budget
can be tighter. Rejection occurs before allocation and preserves the preceding
displayed frame; resolution is never silently changed to satisfy the budget.

Inspection traces the picked mark and explains the aggregate separately under
Rendering → Accumulation: weighted count, contributor count, reference, exposure,
final RGB and up to 32 contributor sample ordinals. Truncation is explicit. The
displayed reference stays with its frame, including real worker inspection.

`tests/density.js` compares independent per-probe oracles for shapes, fractional
edges, clipping, depth and opacity; checks memory/budgets, profiles, geometry reuse,
aggregate inspection and worker metadata. Chromium exercises both depth modes.
