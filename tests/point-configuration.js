import assert from "node:assert/strict";
import {
  spaces,
  compilePosition,
  configurationFactors,
  presetConfiguration,
  validateConfiguration,
  factorIndices,
} from "../point-configuration.js";
import { defaultAppearance } from "../appearance.js";
import { executeRender } from "../rendering.js";
import { RenderCanvas } from "./render-canvas.js";
const byteSource = new Blob([
  Uint8Array.from({ length: 2048 }, (_, i) => (i * 71 + (i >>> 3)) % 256),
]);
const base = {
  kind: "view",
  source: byteSource,
  sourceId: 1,
  offset: 0,
  length: 256,
  columns: 64,
  rows: 48,
  width: 64,
  height: 48,
  scale: 1,
  pointScale: 1,
  sampleLayout: { columns: 16, rows: 16 },
  shaders: ["entropy", "brightness"],
  rotation: { yaw: -0.6, pitch: 0.45 },
};
const factors = new Float64Array(15),
  xyz = new Float64Array(3);
factors[0] = 0.25;
factors[4] = 0.1;
factors[5] = 0.2;
factors[factorIndices.byte2] = 0.5;
factors[factorIndices.byte3] = 0.75;
for (const space of Object.keys(spaces)) {
  const config = { ...presetConfiguration("trigraph"), space };
  compilePosition(config)(factors, xyz);
  assert(xyz.every(Number.isFinite));
  if (space === "square") assert.deepEqual([...xyz], [-0.5, 0, 0]);
  if (space === "cube") assert.deepEqual([...xyz], [-0.5, 0, 0.5]);
  if (space === "circle")
    assert(Math.abs(Math.hypot(xyz[0], xyz[1]) - 0.25) < 1e-12);
  if (space === "sphere") assert(Math.abs(Math.hypot(...xyz) - 0.25) < 1e-12);
}
const repeated = {
  ...presetConfiguration("trigraph"),
  position: ["count", "count", "none"],
};
assert.deepEqual(
  validateConfiguration(repeated).position,
  repeated.position,
  "Factors may be assigned more than once",
);
assert.deepEqual(
  validateConfiguration({
    ...repeated,
    position: ["entropy", "phase", "byte3"],
  }).position,
  ["entropy", "phase", "byte3"],
);
assert.throws(() =>
  validateConfiguration({
    ...repeated,
    position: ["unknown", "byte2", "byte3"],
  }),
);
assert.throws(() => validateConfiguration({ ...repeated, space: "unknown" }));
for (const region of ["linear", "hilbert", "digraph", "trigraph", "dft"])
  for (const space of Object.keys(spaces)) {
    const configuration = { ...presetConfiguration(region), space };
    const available = configurationFactors(configuration).map(
      (item) => item.value,
    );
    const appearance = { ...defaultAppearance(region), hue: available[1] };
    const job = { ...base, region, configuration, appearance };
    const cache = {},
      canvas = new RenderCanvas(),
      fresh = new RenderCanvas();
    await executeRender(canvas, job, cache);
    assert(
      canvas.pixels.some((value, index) => index % 4 !== 3 && value > 0),
      `${region}/${space} is empty`,
    );
    const first = canvas.pixels.slice(),
      prepared = cache.preparedPoints;
    await executeRender(
      canvas,
      { ...job, rotation: { yaw: 0.8, pitch: 0.2 } },
      cache,
    );
    assert.equal(
      cache.preparedPoints,
      prepared,
      "Camera changes must reuse prepared points",
    );
    if (spaces[space].length === 3)
      assert.notDeepEqual(
        canvas.pixels,
        first,
        "Camera must rotate every 3D grouping",
      );
    await executeRender(
      canvas,
      { ...job, columns: 32, rows: 24, pointScale: 0.5 },
      cache,
    );
    assert.equal(
      cache.preparedPoints,
      prepared,
      "Resolution changes must reuse prepared points",
    );
    const moved = { ...job, offset: 32 };
    await executeRender(canvas, moved, cache);
    await executeRender(fresh, moved);
    assert.deepEqual(
      canvas.pixels,
      fresh.pixels,
      `${region}/${space} sliding cache differs`,
    );
    const different = {
      ...configuration,
      position: [available.at(-1), available[1], "none"],
    };
    await executeRender(canvas, { ...job, configuration: different }, cache);
    assert.notDeepEqual(
      canvas.pixels,
      first,
      `${region}/${space} positions ignored`,
    );
  }
for (const layout of ["linear", "hilbert"]) {
  const job = {
    ...base,
    region: layout,
    configuration: { ...presetConfiguration(layout), space: "sphere" },
    shaders: ["character"],
    appearance: { ...defaultAppearance("linear"), hue: "column", size: "row" },
  };
  const canvas = new RenderCanvas();
  await executeRender(canvas, job);
  assert(
    canvas.commands.some((command) => command[0] === "text"),
    "Character labels missing",
  );
}
const inverted = {
  ...presetConfiguration("linear"),
  inverted: [true, false, false],
};
compilePosition(inverted)(factors, xyz);
assert(Math.abs(xyz[0] - 0.8) < 1e-12);
assert.equal(
  await executeRender(
    new RenderCanvas(),
    { ...base, region: "linear", configuration: inverted },
    {},
    () => false,
  ),
  null,
);
console.log(
  "Point configuration checks pass: all 25 preset/space combinations, factor reuse, inversion, validation, camera cache, scrolling, text, layouts, cancellation.",
);

assert.equal(presetConfiguration("trigraph").adaptiveResolution, false);
assert.equal(
  validateConfiguration({
    ...presetConfiguration("trigraph"),
    adaptiveResolution: true,
  }).adaptiveResolution,
  true,
);
assert.throws(
  () =>
    validateConfiguration({
      ...presetConfiguration("trigraph"),
      adaptiveResolution: "yes",
    }),
  /boolean/,
);
