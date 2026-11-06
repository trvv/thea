# Packed pixels and bitmap interpretations

Status: proposal. This adds an interpretation of bytes, not another renderer.

## What CantorDust implements

CantorDust's [BitMapVisualizer.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/BitMapVisualizer.java) exposes 8-bit,
16-bit ARGB1555, 24-bit RGB and 32-bit ARGB modes, with adjustable scanline width
and byte offset. Its [MetricMap.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/MetricMap.java) can also apply packed
color interpretations along a space-filling curve. The useful feature is the
ability to recognize embedded image data by changing grouping and alignment.

Thea already has explicit grid dimensions, adjacent-byte recipes and opacity.
It does not have named packed-pixel interpretations, an explicit group stride,
or direct RGB recipe outputs. A three-byte window at every source offset also
means something different from consuming nonoverlapping three-byte pixels.

## Smallest useful increment

Begin with a parameterized RGB24 recipe: one mark for each complete three-byte
group, source alignment, configurable RGB/BGR channel order, and a width in pixels.
Follow with RGBA32/BGRA32 and explicit straight-alpha semantics. Reuse the normal
position/appearance pipeline so the same interpretation can occupy a grid,
Hilbert curve, radial form or custom coordinate recipe.

A record population or explicit byte stride must retain its true byte offset;
point ordinal is the pixel index, while the source address advances by three or
four. Do not approximate stride by changing the sample limit. Existing continuous
hue/brightness is unsuitable for exact RGB reconstruction: either add RGB output
slots with one canonical color conversion boundary or a validated RGB-to-HSV
vector operation. Keep the stored format independent of that decision.

## Parameters and boundaries

Specify channel order, bits per component, endian order for packed words, row
stride in bytes, origin offset, and row orientation. Pixel width and byte stride
are distinct, particularly with row padding. A pixel containing unavailable bytes
is invalid; do not silently borrow the final complete group or paint synthetic
black. Reading a partial final row is useful and must preserve its missing cells.
Alpha zero is valid transparency, not absent input. Premultiplied alpha needs an
explicit interpretation if introduced later.

ARGB1555 and RGB565 can build on [numeric reads](numeric-interpretations.md) and
[bit extraction](bit-structure.md). Palettes, planar channels and tiled textures
are extensions proposed here; their presence is not established by the inspected
CantorDust bitmap implementation. Defer them until a fixture demonstrates need.

## Performance and inspection

Read only requested groups plus bounded padding; decode multiple channels once.
Shader evaluation may extract channels directly after CPU/GPU parity exists.
Keep one renderer and cache decoded providers by interpretation parameters.
Inspection should show the full contributing byte span, raw word, channels,
alpha and row/pixel coordinates. Use nearest-cell display for faithful inspection
rather than smoothing across neighboring decoded pixels.

Acceptance fixtures: RGB/BGR primary-color tiles, transparent RGBA, both packed
word endian orders, a padded two-row image, shifted alignment, incomplete final
pixel, and identical decoded colors in grid and Hilbert coordinates. This fits
after numeric reads/bit operations and explicit strided-record semantics.
