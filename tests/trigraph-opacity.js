import assert from "node:assert/strict";
import { executeRender } from "../src/render/rendering.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import {
  defaultAppearance,
  occurrenceFactor,
} from "../src/recipes/appearance.js";
import { constant } from "../src/recipes/recipes.js";
import { RenderCanvas } from "./render-canvas.js";
const configuration = {
  ...presetConfiguration("linear"),
  space: "cube",
  footprint: "point",
  position: [constant(0.5), constant(0.5), "value"],
};
const appearance = {
  ...defaultAppearance("linear", []),
  hue: "none",
  lightness: "none",
  opacity: constant(0.5),
};
const base = {
  kind: "view",
  region: "linear",
  offset: 0,
  columns: 256,
  rows: 256,
  rotation: { yaw: 0, pitch: 0 },
  shaders: [],
  configuration,
  appearance,
  sampleLayout: { columns: 16, rows: 1 },
};
async function draw(bytes, patch = {}, cache = {}) {
  const canvas = new RenderCanvas();
  await executeRender(
    canvas,
    {
      ...base,
      source: new Blob([Uint8Array.from(bytes)]),
      length: bytes.length,
      ...patch,
    },
    cache,
  );
  return canvas.pixels;
}
const center = (127 * 256 + 127) * 4;
const one = await draw([255]),
  both = await draw([0, 255]);
assert.equal(one[center], 128);
assert(
  both[center] > one[center],
  "Rear particles must contribute through translucent fronts",
);
assert.deepEqual(
  both,
  await draw([255, 0]),
  "Depth order depends on insertion order",
);
const colored = { ...appearance, hue: "value" };
assert.deepEqual(
  await draw([0, 255], { appearance: colored }),
  await draw([255, 0], { appearance: colored }),
  "Colored transparency order changed",
);
const cache = {};
await draw(
  [255],
  { appearance: { ...appearance, opacity: "byteCount" } },
  cache,
);
assert.equal(
  cache.preparedPoints.colors[3],
  Math.round(255 * occurrenceFactor(1)),
);
await draw(
  new Array(16).fill(255),
  { appearance: { ...appearance, opacity: "byteCount" } },
  cache,
);
assert.equal(
  cache.preparedPoints.colors[3],
  Math.round(255 * occurrenceFactor(16)),
);
for (const opacity of ["none", constant(0.1), "byteCount", constant(1)]) {
  const source = new Blob([Uint8Array.from([0, 255, 128])]),
    settings = {
      ...base,
      source,
      length: 3,
      appearance: { ...colored, opacity },
    };
  const a = new RenderCanvas(),
    b = new RenderCanvas();
  await executeRender(a, settings, cache);
  await executeRender(b, settings);
  assert.deepEqual(
    a.pixels,
    b.pixels,
    "Changing opacity leaked cached colors or ordering",
  );
}
console.log(
  "Opacity checks pass: rear visibility, colored depth order, occurrence mapping, opaque/translucent cache changes.",
);
