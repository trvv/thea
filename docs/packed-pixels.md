# Packed pixels and RGB appearance

Preset → Load → Packed Pixels supplies GRAY8, RGB24, BGR24, RGBA32, BGRA32,
ARGB32, RGB565 and ARGB1555 configurations. They use complete strided records,
ordinary byte/arithmetic recipes, RGB appearance and the same general renderer.
The last chosen template is restored on refresh like the other built-ins; save
customized dimensions and channels as a named preset.

Position → Width controls the pixel row width. Advanced exposes Record Stride,
Record Origin and Record Width, all in source bytes. Origin is relative to the
selected interval. Width determines completeness; stride determines successive
starts. Incomplete trailing pixels have no mark and are not zero-padded. Grid
rows use record count rather than raw byte count, and vertical navigation advances
a pixel row in byte units. Sampling can still omit records under the normal
sample limit; it never redefines the pixel's byte packing.

`packedPixels({format, width, stride, origin, endian})` returns configuration,
appearance and shader flags. The two packed 16-bit formats support explicit
little/big endian. Palette and planar formats remain separate interpretations.
RGBA alpha comes from the source; the usual ordered compositing and coverage
rules still apply. An image-like pattern does not establish a file format.

Points → Color Space selects HSL or RGB. RGB channels map normalized recipes
directly to 0–255, without HSL headroom or an implicit palette. Opacity and size
remain independent. Every position, channel and population is still editable;
RGB appearance is available to any configuration. Inspection shows record spans
and each contributing byte/channel calculation. Existing profiles default to HSL.

`tests/packed-pixels.js` checks exact channels, alpha, packed fields, byte order,
padding/stride, completeness, provenance and JSON round trips. Chromium tests
exercise the real template and RGB popup, alongside CPU/WebGL coverage checks.
