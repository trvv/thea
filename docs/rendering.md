# Rendering, scheduling, and performance

## The job is the thread boundary

`RenderEngine` owns a visible canvas. It assigns each root Blob a stable numeric
`sourceId` through a WeakMap, then sends serializable jobs to the shared
`executeRender` dispatcher locally or through `render-worker.js`. A Blob's object
identity can change under structured cloning, so worker caches must use sourceId
when available. IDs are unique **within one engine**, not across the application.

Important job fields:

| Field | Meaning |
| --- | --- |
| `kind` | `view` or `bar`. |
| `source`, `sourceId` | Immutable Blob and its engine-local stable identity. |
| `offset`, `length` | Byte interval relative to that job's source, normally the root Blob. |
| `region` | Historical preset identifier; still chooses native paths and compatibility defaults. |
| `configuration` | When present, selects the general point/recipe renderer. |
| `sampleLayout` | Native sample columns/rows, independent of adaptive raster quality. |
| `columns`, `rows` | Native logical dimensions for some presets; actual raster dimensions for general points and native 3D. |
| `width`, `height`, `scale` | View CSS dimensions and DPR; bar width/height already identify its overview raster. |
| `pointScale` | DPR × quality scale where applicable, preserving particle size in CSS pixels. |
| `appearance`, `shaders` | Mapping overrides and compatibility flags; `shaders` is not GPU execution. |
| `rotation`, `interacting`, `resolutionScale` | Camera and quality-feedback snapshot. |
| `coordinateSystem`, `axes` | Legacy image/packed-tuple transforms; raw points use `configuration.space` instead. |

Jobs should be treated as immutable snapshots once dispatched. The worker gets
expression data and reconstructs runtime plans; it does not receive DOM nodes,
callbacks, evaluators, or a transferable live selection controller.

Each worker owns one OffscreenCanvas and one cache object. It executes a job and
returns `{id, bitmap, duration, work}` or an error string. The caller draws and
closes every transferred ImageBitmap, including stale results. `executeRender`
returns null on superseded preparation, not an empty successful frame.

## Scheduling and presentation are separate policies

The initial UI-thread budget is 8 ms. `renderCost` estimates structural work;
`RenderEngine` learns smoothed time-per-work-unit rates. Arbitrary-length FFTs,
text, output raster size, and reachable recipe providers affect the estimate.
These work units are internal calibration values, not byte counts or an FPS
promise. Native helpers and general jobs do not report perfectly identical timing
boundaries; use end-to-end frame timing for interaction feedback.

When supported, expensive work goes to a worker. Once a mode has been offloaded,
its later jobs stay there so incremental caches do not alternate between two
threads. There is one active worker job and one replaceable pending request.
Replacing the pending request resolves it false rather than allowing a long queue
of obsolete frames to accumulate.

Worker jobs finish serially under the engine protocol. A newer request does not
interrupt a running worker's CPU loop. Instead, presentation checks determine
whether the finished bitmap is still useful:

- Never show an ID already presented.
- Show the latest request normally.
- During compatible progressive scrolling, permit ordered intermediate frames;
  otherwise rapid input could keep every completed frame invisible.
- Do not show an old source, mapping, encoding, dimensions, or incompatible
  sampling specification just because its computation finished last.

`render-identity.js` owns the setting lists used by preparation, presentation,
and quality feedback. `appearanceKey` includes configuration, sample layout,
appearance, text, and compatibility settings. When
adding a render-affecting setting, audit stale-frame checks as well as drawing
code. Native camera-only compatibility has an additional presentation allowance.

Before painting a local async job, `current()` must still be true after source
reads. Incremental helpers must stage changes until that check succeeds. An old
request may otherwise leave a cache that produces plausible but incorrect future
frames. Do not call `executeRender` concurrently with the same mutable cache from
an unrelated scheduler.

Worker creation/execution failure disables offloading for that engine and retries
the latest request locally. Disconnecting a canvas terminates its worker, settles
pending promises, invalidates continuations, and clears caches/offloading affinity.
Learned calibration rates remain on the engine instance.

## What gets cached

| Cache / owner | Reuse and invalidation |
| --- | --- |
| Bar overview pages | Root-source prefix sums; page LRU survives scope changes, changes identity with the source. |
| Native grid palettes | Integer byte/entropy → packed color; fractional averages bypass the integer palette. |
| Byte/pair/triple histograms | Shared native/general incremental selected-window counts; changes are staged before commit. |
| Spectrum coefficients | Shared native/general exact-selection cache, reused across display/mapping changes. |
| Native trigraph histogram | Root source and selected interval; overlap can update entering/leaving triple starts. |
| Native projected tuple slots | Histogram Map/revision and camera/space/axes/size; consecutive revisions permit small repairs. |
| Native visibility raster | Screen dimensions and projected geometry; dirty tiles repair changed coverage. |
| General `factorWindow` | One selected window with any required entropy halo. A later larger halo upgrades the read. |
| General provider results | Separate one-window caches for requested entropy sizes, counts, and spectrum components. |
| General `preparedPoints` | Source, selection, sample layout, mappings/definitions, appearance, text settings. Camera and output-raster dimensions are excluded. |
| Recipe plans | Bounded request/canonical caches; structurally identical cloned expressions reuse a plan. |
| Per-evaluator scratch | Allocated independently from the shared IR so concurrent canvases cannot alias point values. |

Caches in the UI thread and worker are distinct. Moving a mode between them loses
that mode's warm state. Mutating an expression without going through the setters
also bypasses validation and render scheduling; use immutable replacement.

### Overview pages

Each page covers 65,536 bytes and stores a Uint32 prefix sum. At 255 per byte the
sum still fits in 32 bits. The LRU retains 64 pages, roughly 16 MiB per bar. A sparse page-total Map survives prefix eviction; whole
pages use those totals without rebuilding prefixes. The last completed overview
raster is also reused for identical ranges and pixel counts. Each
pixel averages its exact byte interval; this makes navigating nested scopes
consistent rather than changing the sampling approximation as the window moves.

### Native trigraph

Sliding triples overlap by two bytes. Histogram keys are packed as
`first * 65536 + second * 256 + third`. A changed window updates only outgoing and
incoming **valid triple starts** when that is cheaper than a full rebuild. Reads
include the extra trailing bytes needed to form boundary tuples. All changed
reads complete before the existing Map is mutated.

The raster tracks dense typed-array slots, a key→slot Map, and linked spatial bins
with 2-pixel tiles. Removing a slot can move the final slot into it. That move must
repair bin links **and stored visibility owner IDs**. Revision gaps, a new Map, or
camera/viewport changes require rebuilding instead of applying an incomplete delta.

Opaque particles keep four independent depth owners per pixel. This preserves rear
particles through partially covered edges; fading one nearest particle against
black creates dark halos. Depth ties use stable tuple keys rather than Map order.
Changing occurrence counts can also change the frame's peak shade, so cached
geometry does not mean cached final brightness is valid.

For white particles, opacity is order independent. Optical depth adds as
`0.25 * log1p(count)` and transmittance is its negative exponential. Incremental
removal/insertion can update that sum without sorting. This shortcut must not be
reused for particles with different colors.

Native custom appearance keeps tuple aggregation/projection but depth-sorts
colored marks. The general point renderer also sorts 3D marks back-to-front. Its
four coverage probes are combined into a pixel alpha blend, unlike the native
opaque renderer's four retained depth owners. Their edge behavior is not promised
to be identical.

## Adaptive resolution

Quality changes belong to 3D **spaces**, not only the Trigraph preset. The default
budget is approximately 16.7 ms. The controller requires two sustained slow reports
before reducing dimension scale, ignores one resized-cache warmup report, and
requires six sufficiently fast reports to increase it. Scale never goes below
0.25, and roughly 180 ms without motion restores full detail.

A reduction that fails to improve timing is rolled back and locked for that
interaction. This is important when histogram work, an FFT, or point preparation
is the bottleneck: shrinking the canvas cannot fix it. Feedback from a stale
source, mapping, viewport, or quality scale is ignored.

`pointScale` changes alongside the raster so particles keep their CSS size, and
`sampleLayout` stays native so the selection does not change. Perspective size is
continuous, using the same `3.5 - depth` denominator as projection; avoid integer
size/depth buckets that make particles pop near the camera.

## Cost and memory pitfalls

Offloading preserves UI responsiveness; it does not remove computation. General
colored 3D rendering still sorts points on the CPU. CPU rasterization is the default;
`configuration.backend: "webgl"` uploads sorted marks for instanced quad drawing.
It retains the four-probe coverage rule and falls back on unavailable WebGL2,
viewport limits, errors, or context loss. Providers, recipes, projection, sorting,
and text still run on CPU. Browser tests compare both mark shapes across all
spaces within three 8-bit color steps, with a tighter mean-error bound. Camera changes
reuse prepared points but need new projection/sorting/compositing. Adaptive scale
cannot reduce fixed per-point work.

General points default to a 262,144-point sample budget. This bounds prepared
mark/sort storage, not exact provider arrays or tuple-discovery metadata. Projection,
order, and software image buffers are reused between frames.

FFT buffers can greatly exceed selected bytes: Bluestein uses power-of-two
convolution buffers for non-power-of-two selections, and returned Float64 views
can retain larger backing buffers. The shared spectrum cache copies only the one-sided coefficients so those padded
working buffers can be released. Phase/amplitude arrays and normalization are
additional work only when requested.

Overview LRUs are per bar. Entropy arrays are per requested window size. Triple
histograms can contain many distinct keys. Native depth/owner arrays alone cost
48 bytes per raster pixel (four Float64 depths and four Uint32 owners), before
backgrounds, opacity arrays, and particle storage. High DPR and many bars can
therefore consume substantial memory even for a modest source file.

`tests/scroll-benchmark.js` measures CPU work with a canvas double. It excludes
browser text rendering, real ImageBitmap transfer, canvas compositing, and GPU
presentation. Use it for relative algorithm changes, not universal FPS claims.
