# Browser and device evidence

The browser smoke suite runs Chromium 156.0.8078.47 in this Fedora 44 container,
using headless ANGLE SwiftShader. It exercises CPU Canvas, module workers,
OffscreenCanvas/ImageBitmap, native popovers, DPR, source replacement, recipes,
inspection, comparisons, and WebGL coverage/context loss. Shader function tests
also compile/link/execute 29 fixture graphs through surfaceless GLES.

| Environment                        | Evidence                                                               |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Chromium CPU/local and real worker | Automated numerical, lifecycle and browser integration checks.         |
| Chromium WebGL/SwiftShader         | Automated coverage parity, failure fallback and upload reuse.          |
| Generated GLSL/GLES functions      | Executed representative fixtures; not a GPU analysis-provider backend. |
| Generated WGSL                     | Structural generation only; no real-device execution claim.            |
| Firefox and Safari                 | Not installed/available in this container; not tested.                 |
| Physical integrated/discrete GPUs  | Not exposed for characterization here; not tested.                     |

CPU remains the default. Optional [WebGL recipe/projection execution](gpu-execution.md)
and shared-worker source/spectrum reuse now have runtime Chromium checks.
Projection readback is slower on the measured software device; physical GPU gains,
WebGPU compute and WGSL execution are not inferred from these tests. HTTP Range/live-input transports are outside the user's
current fixed-file browser-app scope; native File and complete URL Blob loading
remain the source contracts.
