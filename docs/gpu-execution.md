# Optional GPU execution

Advanced → GPU Execution exposes Projection and Recipes independently. Both
flags default off and are saved with presets. Backend still chooses the rasterizer;
these flags choose where earlier arithmetic runs, including when CPU rasterization
is used. Unsupported execution retains the same CPU providers and evaluator.
Pipeline fusion is not involved.

`point-compute.js` uses WebGL2 transform feedback, not WebGPU. It captures shader
outputs in buffers, then reads them back for the existing coordinate/appearance,
depth ordering, raster and inspection stages. Projection uploads immutable world
geometry once; camera uniforms change independently. Recipe execution uploads
source factors and exact point offsets/indices. Indexed byte, entropy and supported
spectral providers use float textures, reused while their input arrays are identical.
Shaders come from the existing typed recipe emitter, not a preset-specific implementation.

The current backend accepts at most eight scalar roots and 31-bit point/selection
indices, with conservative fallback for exact-index arithmetic graphs. Numeric and
statistical lookup descriptors, unsupported spectrum descriptors, sparse-only
provider arrays, device texture limits and work exceeding the smaller of a configured
provider budget or 64 MiB use CPU evaluation. These are execution eligibility
limits, not restrictions on valid configurations. Raw numeric64 interpretation and
statistical model construction remain CPU operations. WebGPU/FFT compute is not
implemented by this backend.

GPU projection/recipes use device float32 arithmetic. Browser fixtures compare
visible output with the CPU reference using the existing narrow pixel tolerances;
near-equal projected depths can differ at float32 rounding boundaries. Inspection
uses the prepared geometry and displayed projection. Raw source/analysis values
retain the CPU interpretation contract. Context loss or execution failure returns
to CPU; disabling both flags disposes the context and its retained scratch buffers.

## Measurements and limits

Run the non-gating browser measurements with:

```sh
bun tests/browser-smoke.js --benchmark
```

A Chromium/ANGLE SwiftShader run on 65,536 Hilbert 3D marks, repeatedly changing
geometry, measured these steady median total/preparation times:

| Execution      |   Total | Preparation |
| -------------- | ------: | ----------: |
| CPU            | 60.3 ms |     38.5 ms |
| GPU recipes    | 46.9 ms |     24.8 ms |
| GPU projection | 64.5 ms |     39.6 ms |
| Both           | 48.4 ms |     24.1 ms |

Readback makes projection slower on this software device. These figures justify
an optional recipe experiment, not an accelerated default or a claim of physical-GPU
benefit. Small/simple graphs can also lose time to packing and readback. Browser
checks execute factor, byte/entropy, Hilbert 3D and spectral graphs, projection,
context fallback and shared-worker rendering. WGSL, Firefox/Safari and physical
GPU validation remain unavailable in the current environment.

The API contracts are documented by MDN:
[transform feedback](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/transformFeedbackVaryings)
and [buffer readback](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/getBufferSubData).
