# Density accumulation and robust display scaling

Current delivery: Raw counts and fixed/percentile exposure are implemented. Screen-space accumulation retains its distinct optional rendering/contributor contract. See [implemented behavior](../statistical-analyses.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Original proposal: Keep measurement and display normalization separately named.

## What CantorDust implements

[DensityShader.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/DensityShader.java) constructs a logarithmic tone
mapping referenced to a high percentile of nonempty accumulated pixel counts,
with an adjustable exposure multiplier. [ThreeTupleVisualizer.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/ThreeTupleVisualizer.java)
accumulates projected contributions and uses that shared mapping; it also retains
a pick identity. This makes structure visible when a few very common tuples would
otherwise dominate the image.

Thea offers count-derived brightness/opacity and ordinary point compositing. Its
compressed count factors have a fixed mapping, without a distribution-relative
reference. Drawing translucent marks is not equivalent to accumulating evidence
before tone mapping.

## Two distinct increments

First expose raw counts and reusable scalar normalization parameters: logarithmic
compression, chosen reference and exposure. An explicitly requested percentile
reduction over a named population can produce a reference once per analysis
revision. This improves density-related recipes while retaining the current
renderer. State whether the percentile includes zero-count values and whether it
is over unique tuples, bytes, or another population. Sampling must not silently
change the reference distribution.

Second, if fixtures justify it, add a generic density accumulation rendering mode
available to every configuration. Projected contributions fill a numeric screen
buffer, then one shared transfer function produces pixels. Define each mark's
weight: one occurrence, its population count, a recipe output or covered area are
different measurements. Independent configurations can share the same stages
without restoring preset-specific painters.

## Caveats

Screen-space density changes with camera, zoom, footprint and output resolution;
selection-space tuple count does not. Do not describe one as the other. Depth
occlusion versus x-ray accumulation is another explicit choice. A displayed pixel
may combine many distinct marks, so inspection cannot claim its picked contributor
alone explains its final color. Provide an aggregate summary and a bounded list
or a documented representative policy. Large contributor lists must stay on demand.

A percentile computed on screen pixels can cause exposure changes while rotating.
Offer fixed-reference scaling for comparisons, and store policy parameters rather
than derived source-specific quantiles in presets. Upstream's chosen percentile
is not a universal constant for Thea's different populations and render sizes.

## Order and validation

Do raw-count/reference normalization after histogram APIs and before training-based
scores; postpone density accumulation until performance measurements justify its
extra buffers and CPU/GPU parity work. Reuse typed buffers, bound the accumulation
range, define overflow handling, and keep picking freshness tied to the exact
presented frame. Avoid broadening the default renderer until this mode has useful
fixtures.

Test a dominant repeated tuple with many rare values, equal counts, empty input,
all-zero references, stable fixed-reference comparisons, camera-dependent versus
selection-dependent density, overlap picking and equivalent CPU/GPU accumulation.
