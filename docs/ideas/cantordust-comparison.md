# CantorDust comparison and transferable ideas

This review inspected [Battelle/cantordust](https://github.com/Battelle/cantordust)
at commit [32aff4173b640d440641ea9076c80fe85000b2f0](https://github.com/Battelle/cantordust/commit/32aff4173b640d440641ea9076c80fe85000b2f0)
on 2026-11-05, comparing implementation and comments with Thea's current code and
existing proposals. The current upstream checkout includes work not represented
in older search snippets, including standalone hosting, a hex panel and an actual
3D triple view. This is a source review, not a claim that the Java/Ghidra runtime
was exercised here.

The writeups below describe proposed Thea work. Upstream implementation is
identified separately from extensions inferred from it. No Java code or training
assets were copied. The repository carries an
[Apache 2.0 license](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/LICENSE);
a future code or data reuse decision must check applicable notices and the
provenance of any model corpus independently.

## Useful gaps

| Proposal                                                            | Actual gap in Thea                                                  | Initial dependency                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Packed pixel interpretation](cantordust-bitmap-interpretations.md) | Pixel grouping, channel order and faithful RGB/alpha interpretation | Numeric/bit reads, strided records, explicit color output         |
| [Byte-value frequency table](cantordust-byte-cloud.md)              | One mark per byte symbol rather than per position                   | Raw histogram queries and representative occurrence policies      |
| [Morton and H-curve coordinates](cantordust-coordinate-curves.md)   | Alternate explicit vector mappings                                  | Exact index/bit operations; Morton first                          |
| [Content resemblance](cantordust-content-classification.md)         | Named reference-model scores and uncertainty                        | Bounded providers, distributions, scoring and model artifacts     |
| [Occurrence navigation](cantordust-occurrence-navigation.md)        | Visit further pattern matches and inspect surrounding bytes         | Occurrence queries, bounded reads and explicit navigation targets |
| [Linked views](cantordust-linked-views.md)                          | Multiple configurations coordinated by one source interval          | Shared source ownership, cache budgets and cleanup                |
| [Density mapping](cantordust-density-mapping.md)                    | Distribution-relative exposure and optional generic accumulation    | Raw counts first; renderer accumulation later                     |

These are complementary rather than seven mandatory new viewing modes. Bitmap
and Morton can be recipe templates, symbol counts a population, classification a
provider, navigation an inspection action, and linked views a host responsibility.
Keep mixed analyses available everywhere and add no preset-specific painters.

## Features already represented

Thea already has nested region selection, byte/pair/triple visualizations, a real
3D camera, Hilbert mappings, entropy shading, freely mixed factors, source-derived
inspection and a generic renderer. Upstream's corresponding visualizers are not
new feature ideas merely because their menus have different names. Plain grayscale,
byte categories and many palette experiments can be existing recipes rather than
new providers. Constant hue settings, radial forms and count opacity already cover
several upstream appearance controls.

Upstream's ColorSpectrum name describes mapping a byte-derived symbol through an
RGB Hilbert curve; it should not be confused with Thea's DFT frequency analysis.
Likewise its named 64bpp class is not evidence of a validated 64-bit pixel format;
new numeric formats require a defined bit/channel contract and fixtures.

## Suggested implementation order

1. Implement compact bit/numeric primitives, raw statistics and explicit validity.
2. Add Morton recipes and the byte-symbol population as small bounded increments.
3. Establish strided-record/color contracts, then faithful bitmap presets.
4. Add occurrence browsing and bounded context to inspection.
5. Add explicit normalization references; evaluate density accumulation separately.
6. Share immutable source preparation and then add an optional comparison view.
7. Build reference-model scoring only after budget/uncertainty contracts exist.

H-curve, palette/planar texture formats, external-tool adapters and a shipped
architecture corpus are later extensions with their own acceptance evidence.
Source-based claims are linked in each proposal so later reviews can distinguish
what upstream actually provides from the proposed Thea design.
