import assert from "node:assert/strict";
import { paintCPU } from "../point-raster.js";
import { RenderCanvas } from "./render-canvas.js";
// Independent, deliberately slow four-probe reference. This locks down all optimized paths.
function reference(prepared, projection) {
  const { width, height, projected, order, spatial, cellWidth, cellHeight } =
    projection;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  for (let n = 0; n < prepared.size; n++) {
    const i = order ? order[n] : n,
      q = i * 4,
      x = projected[q],
      y = projected[q + 1];
    const halfX =
        (spatial ? projected[q + 3] : cellWidth / 2) * prepared.sizes[i],
      halfY = (spatial ? projected[q + 3] : cellHeight / 2) * prepared.sizes[i];
    const alpha = prepared.colors[q + 3] / 255;
    if (!alpha || !(halfX > 0 && halfY > 0)) continue;
    for (let py = 0; py < height; py++)
      for (let px = 0; px < width; px++) {
        let coverage = 0;
        for (let probe = 0; probe < 4; probe++) {
          const nx = (px + (probe & 1 ? 0.75 : 0.25) - x) / halfX,
            ny = (py + (probe & 2 ? 0.75 : 0.25) - y) / halfY;
          if (
            prepared.shape === "circle"
              ? nx * nx + ny * ny <= 1
              : Math.abs(nx) <= 1 && Math.abs(ny) <= 1
          )
            coverage++;
        }
        const a = (alpha * coverage) / 4,
          p = (py * width + px) * 4;
        for (let c = 0; c < 3; c++)
          pixels[p + c] = Math.round(
            prepared.colors[q + c] * a + pixels[p + c] * (1 - a),
          );
      }
  }
  return pixels;
}
let seed = 124;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const scratch = {},
  canvas = new RenderCanvas();
for (const shape of ["square", "circle"])
  for (const spatial of [false, true])
    for (let frame = 0; frame < 50; frame++) {
      const size = 24,
        width = frame % 2 ? 19 : 31,
        height = 23,
        colors = Uint8ClampedArray.from(
          { length: size * 4 },
          () => random() * 255,
        );
      for (let i = 0; i < size; i++)
        colors[i * 4 + 3] = i % 3 ? 255 : i % 2 ? 0 : 128;
      const sizes = Float32Array.from({ length: size }, () => random() * 3),
        projected = Float32Array.from({ length: size * 4 }, (_, i) =>
          i % 4 === 3 ? random() * 8 : random() * 40 - 8,
        );
      // Exercise exact quarter-pixel boundaries as well as arbitrary subpixel positions.
      projected[0] = 5.5;
      projected[1] = 6.25;
      sizes[0] = 1;
      projected[3] = 2.25;
      const prepared = { shape, size, colors, sizes },
        projection = {
          width,
          height,
          projected,
          spatial,
          cellWidth: 4.5,
          cellHeight: 2.25,
          order: spatial
            ? Uint32Array.from({ length: size }, (_, i) => size - 1 - i)
            : null,
        };
      paintCPU(canvas.context, prepared, projection, scratch);
      assert.deepEqual(
        canvas.pixels,
        reference(prepared, projection),
        `${shape}/${spatial}/${frame}: coverage or blending changed`,
      );
    }
console.log(
  "Raster checks pass: opaque row fills, square edge coverage, circles, transparency, order, clipping, fractional sizes, storage reuse.",
);
