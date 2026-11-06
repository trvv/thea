import assert from "node:assert/strict";
import { packedPixels } from "../packed-pixels.js";
import { executeRender } from "../rendering.js";
import { inspectPoint } from "../point-inspection.js";
import { validateProfile } from "../profiles.js";
import { RenderCanvas } from "./render-canvas.js";

async function render(bytes, parameters) {
  const template = packedPixels({ width: 2, ...parameters });
  const job = {
    kind: "view",
    source: new Blob([Uint8Array.from(bytes)]),
    offset: 0,
    length: bytes.length,
    columns: 32,
    rows: 32,
    region: "linear",
    sampleLayout: { columns: 16, rows: 16 },
    ...template,
  };
  const cache = {};
  await executeRender(new RenderCanvas(), job, cache);
  return {
    job,
    cache,
    colors: [
      ...cache.preparedPoints.colors.subarray(0, cache.preparedPoints.size * 4),
    ],
  };
}
for (const [format, bytes, expected] of [
  ["rgb24", [255, 0, 0, 0, 255, 0], [255, 0, 0, 255, 0, 255, 0, 255]],
  ["bgr24", [0, 0, 255, 0, 255, 0], [255, 0, 0, 255, 0, 255, 0, 255]],
  ["rgba32", [5, 17, 201, 128], [5, 17, 201, 128]],
  ["bgra32", [201, 17, 5, 128], [5, 17, 201, 128]],
  ["argb32", [128, 5, 17, 201], [5, 17, 201, 128]],
  [
    "gray8",
    [0, 127, 255],
    [0, 0, 0, 255, 127, 127, 127, 255, 255, 255, 255, 255],
  ],
  [
    "rgb565",
    [0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00],
    [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255],
  ],
  ["argb1555", [0x00, 0xfc, 0xe0, 0x03], [255, 0, 0, 255, 0, 255, 0, 0]],
])
  assert.deepEqual((await render(bytes, { format })).colors, expected, format);
assert.deepEqual(
  (await render([0xf8, 0], { format: "rgb565", endian: "big" })).colors,
  [255, 0, 0, 255],
);
const strided = await render([99, 7, 8, 9, 88, 10, 11, 12, 66, 1, 2], {
  format: "rgb24",
  origin: 1,
  stride: 4,
});
assert.deepEqual(strided.colors, [7, 8, 9, 255, 10, 11, 12, 255]);
assert.equal(
  strided.cache.preparedPoints.size,
  2,
  "Incomplete trailing pixels must be omitted",
);
const projection = strided.cache.pointRaster.projected;
const info = await inspectPoint(
  strided.job,
  strided.cache,
  projection[0],
  projection[1],
);
assert.equal(info.point.population, "records");
assert.equal(info.point.sourceOffset, 1);
assert.equal(info.point.record.stride, 4);
assert(info.traits.some((trait) => trait.name === "Red"));
assert(
  info.nodes.some(
    (node) =>
      node.op === "byte" &&
      node.source.sourceOffset === 1 &&
      node.source.value === 7,
  ),
);
const profile = validateProfile({
  version: 3,
  region: "linear",
  configuration: strided.job.configuration,
  appearance: strided.job.appearance,
  shaders: [],
  recipes: {},
  coordinateSystem: "cartesian",
  axes: [0, 1],
  rotation: { yaw: 0, pitch: 0 },
  encoding: "ascii",
  blankSpaces: false,
  blankNulls: true,
  frequencyOpacity: false,
});
assert.deepEqual(validateProfile(JSON.parse(JSON.stringify(profile))), profile);
for (const options of [
  { format: "unknown" },
  { width: 0 },
  { stride: 2 },
  { origin: -1 },
  { endian: "unknown" },
])
  assert.throws(() => packedPixels(options));
console.log(
  "Packed pixels pass: faithful RGB/alpha channels, byte order, packed16 fields, strided records, incomplete pixels, provenance and profile round trips.",
);
