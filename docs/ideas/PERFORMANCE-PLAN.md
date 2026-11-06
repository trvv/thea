# Performance implementation follow-up

Scope: remaining performance proposals, excluding pipeline fusion. Preserve the
CPU reference, exact selected statistics, inspection and generic configurations.

- [x] Audit existing incremental histograms and improve tuple representative reuse.
- [x] Reuse sparse source ranges independently of expression edits.
- [x] Bound cancellation latency inside radix-2 and arbitrary-length FFTs.
- [x] Reduce density raster memory without changing weighted counts or colors.
- [x] Measure engine queues, presentation latency and retained/peak buffer limits.
- [x] Share immutable analysis work between comparison engines/workers.
- [x] Add optional GPU projection and recipe execution/compute, with CPU fallback,
      executed parity tests and measured limits. No accelerated default without
      physical-device evidence.
- [x] Run regression, browser and non-gating benchmark checks; record caveats.

This document tracks actual delivery, not a claim that every item is already done.

## Delivery boundaries

- Histograms were already incremental. New tuple reuse is deliberately limited
  to low-cardinality populations; high-cardinality scans remain the cheaper reference.
- Default engine leases share a worker and immutable pages/spectra. This saves
  computation/storage but shares a CPU thread; custom independent worker factories
  retain parallel execution as an explicit tradeoff.
- GPU execution is optional WebGL2 transform feedback for supported recipe graphs
  and projection, with texture/index/budget eligibility and CPU fallback. Numeric/
  statistical providers and WebGPU/FFT compute remain CPU/future extensions.
- Density uses exact integer sums only where overflow and opacity rules permit;
  the Float64 reference remains otherwise. Rank selection does not alter exposure.
- Memory telemetry measures known retained typed buffers/high-water snapshots and
  reports FFT allocation estimates. Browser/driver/object heaps and true transient
  process peaks are not claimed observable.

Current contracts and measurements: [performance](../performance.md),
[GPU execution](../gpu-execution.md), [remaining proposals](REMAINING-WORK.md).
