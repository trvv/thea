import assert from "node:assert/strict";
import {
  encodingCandidate,
  encodingResult,
} from "../src/analysis/encoding-analysis.js";
import { executeRender } from "../src/render/rendering.js";
import { inspectPoint } from "../src/inspection/point-inspection.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { RenderCanvas } from "./render-canvas.js";
for (const [encoding, bytes] of [
  ["utf8", [0xf0, 0x9f, 0x98, 0x80]],
  ["utf16le", [0x3d, 0xd8, 0x00, 0xde]],
  ["utf16be", [0xd8, 0x3d, 0xde, 0x00]],
  ["utf32le", [0x00, 0xf6, 0x01, 0x00]],
  ["utf32be", [0, 1, 0xf6, 0]],
]) {
  const input = Uint8Array.from(bytes);
  for (let index = 0; index < input.length; index++) {
    const candidate = encodingCandidate(input, index, { encoding, origin: 0 });
    assert.equal(candidate.scalar, 0x1f600);
    const result = encodingResult(input, index, { encoding, origin: 0 });
    assert.equal(result[0], 0x1f600 / 0x10ffff);
    assert.equal(result[1], 4);
    assert.equal(result[2], index);
    assert.equal(result[3], 1);
  }
}
assert.equal(
  encodingCandidate(Uint8Array.of(0x80), 0, { encoding: "utf8", origin: 0 }),
  null,
);
assert.equal(
  encodingCandidate(Uint8Array.of(0, 65, 0), 1, {
    encoding: "utf16be",
    origin: 1,
  }).scalar,
  0x4100,
);
const bytes = new TextEncoder().encode("A😀Z");
const expression = {
  op: "analysis",
  family: "encoding",
  encoding: "utf8",
  kind: "codePoint",
  offset: { op: "offset" },
};
const job = {
  kind: "view",
  source: new Blob([bytes]),
  offset: 0,
  length: bytes.length,
  columns: 64,
  rows: 64,
  region: "linear",
  configuration: {
    ...presetConfiguration("linear"),
    sampling: "representative",
  },
  appearance: { ...defaultAppearance("linear"), hue: expression },
  sampleLayout: { columns: 3, rows: 2 },
  shaders: [],
};
const cache = {};
await executeRender(new RenderCanvas(), job, cache);
const p = cache.pointRaster.projected;
const info = await inspectPoint(job, cache, p[4], p[5]);
const node = info.nodes.find((node) => node.op === "analysis");
assert.equal(node.source.codePoint, "U+1F600");
assert.deepEqual(node.source.sourceRange, { start: 1, endExclusive: 5 });
console.log(
  "Encoding factors pass: scalar/length/index/validity projections, all encodings/endians, explicit alignment, selected scope and source provenance.",
);
