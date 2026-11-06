import assert from "node:assert/strict";
import {
  pointGrid,
  gridCoordinates,
  resolveDimensions,
  validateDimensions,
} from "../src/recipes/dimensions.js";
import {
  presetConfiguration,
  validateConfiguration,
  compilePosition,
} from "../src/recipes/point-configuration.js";
import { compileRecipes, recipeRoots } from "../src/recipes/recipes.js";
import { pointFactors } from "../src/data/point-factors.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { factorIndices as slots } from "../src/recipes/factor-catalog.js";
import {
  entropyShading,
  hilbertCells,
  byteCharacter,
  executeRender,
} from "../src/render/rendering.js";
import {
  validateProfile,
  serializeProfile,
  parseProfile,
} from "../src/presets/profiles.js";
import { RenderCanvas } from "./render-canvas.js";
const shape = { columns: 16, rows: 16, aspect: 1 },
  base = presetConfiguration("linear");
assert(!("layout" in base) && !("grid" in base));
assert.deepEqual(base.position, ["column", "row", "slice"]);
for (const axis of Object.values(base.dimensions)) assert.equal(axis.fit, true);
const cube = {
  ...base,
  space: "cube",
  dimensions: {
    ...base.dimensions,
    width: { start: 0, end: 4, step: 1, fit: true },
    height: { start: 0, end: 3, step: 1, fit: true },
    depth: { start: 0, end: 3, step: 1, fit: true },
  },
};
const grid = pointGrid(cube, 27, shape),
  xyz = new Float64Array(3);
assert.equal(grid.columns, 4);
assert.equal(grid.rows, 3);
assert.equal(grid.slices, 3);
for (let index = 0; index < 27; index++) {
  gridCoordinates(index, grid, xyz);
  assert.equal(xyz[0], ((index % 4) + 0.5) / 4);
  assert.equal(xyz[1], ((Math.floor(index / 4) % 3) + 0.5) / 3);
  assert.equal(xyz[2], (Math.floor(index / 12) + 0.5) / 3);
}
const independent = pointGrid(
  {
    ...cube,
    dimensions: {
      ...cube.dimensions,
      depth: { start: null, end: null, step: null, fit: true },
    },
  },
  96,
  shape,
);
assert.equal(
  independent.slices,
  8,
  "Unspecified depth should accommodate the selected population",
);
const partial = pointGrid(
  {
    ...cube,
    dimensions: {
      ...cube.dimensions,
      width: { start: 0, end: 5, step: 2, fit: true },
    },
  },
  27,
  shape,
);
assert.equal(partial.columns, 3);
gridCoordinates(2, partial, xyz);
assert.equal(xyz[0], 0.9, "Last partial cell center is incorrect");

// Output ranges and Fit have the same meaning for Cartesian/radial dimensions.
const byteAxes = {
  ...base,
  space: "cube",
  position: ["value", "byte2", "byte3"],
};
let ranges = resolveDimensions(byteAxes, 100, shape);
assert.equal(ranges.width.end, 256);
assert.equal(ranges.width.step, 1);
const limited = {
  ...byteAxes,
  dimensions: {
    ...byteAxes.dimensions,
    width: { start: 0, end: 64, step: 1, fit: true },
  },
};
const factors = new Float64Array(16);
factors[slots.value] = 0.5;
factors[slots.byte2] = 0.5;
factors[slots.byte3] = 0.5;
compilePosition(limited, resolveDimensions(limited, 100, shape))(factors, xyz);
assert.equal(xyz[0], 0);
const unfitted = {
  ...limited,
  dimensions: {
    ...limited.dimensions,
    width: { ...limited.dimensions.width, fit: false },
  },
};
compilePosition(unfitted, resolveDimensions(unfitted, 100, shape))(
  factors,
  xyz,
);
assert.equal(xyz[0], -0.75);
const polar = {
  ...base,
  space: "circle",
  position: ["value", "byte2", "none"],
  dimensions: {
    ...base.dimensions,
    height: { start: 0, end: 90, step: 1, fit: true },
  },
};
ranges = resolveDimensions(polar, 256, shape);
assert.equal(ranges.height.naturalEnd, 360);
assert.equal(ranges.height.count, 90);
compilePosition(polar, ranges)(factors, xyz);
assert(Math.abs(xyz[0] + 0.5) < 1e-12);
assert(Math.abs(xyz[1]) < 1e-12);
const quarter = {
  ...polar,
  dimensions: {
    ...polar.dimensions,
    height: { ...polar.dimensions.height, fit: false },
  },
};
compilePosition(quarter, resolveDimensions(quarter, 256, shape))(factors, xyz);
assert(Math.abs(xyz[0] - Math.SQRT1_2 / 2) < 1e-12);
assert(Math.abs(xyz[1] + Math.SQRT1_2 / 2) < 1e-12);
// Scale/Truncate and Fit are orthogonal, and truncation does not clamp points onto edges.
const crop = {
  ...limited,
  dimensions: {
    ...limited.dimensions,
    width: { ...limited.dimensions.width, mode: "truncate" },
  },
};
factors[slots.value] = 0.125;
compilePosition(crop, resolveDimensions(crop, 100, shape))(factors, xyz);
assert.equal(xyz[0], 0);
const cropUnfit = {
  ...crop,
  dimensions: {
    ...crop.dimensions,
    width: { ...crop.dimensions.width, fit: false },
  },
};
compilePosition(cropUnfit, resolveDimensions(cropUnfit, 100, shape))(
  factors,
  xyz,
);
assert.equal(xyz[0], -0.75);
factors[slots.value] = 0.5;
assert.equal(
  compilePosition(crop, resolveDimensions(crop, 100, shape))(factors, xyz),
  null,
);
const arcCrop = {
  ...polar,
  dimensions: {
    ...polar.dimensions,
    height: { ...polar.dimensions.height, mode: "truncate" },
  },
};
factors[slots.byte2] = 0.5;
assert.equal(
  compilePosition(arcCrop, resolveDimensions(arcCrop, 256, shape))(
    factors,
    xyz,
  ),
  null,
);
factors[slots.byte2] = 0.125;
compilePosition(arcCrop, resolveDimensions(arcCrop, 256, shape))(factors, xyz);
assert(Math.abs(xyz[0] + 0.5) < 1e-12);
factors[slots.byte2] = 0.5;
for (const space of ["circle", "cylinder", "sphere"]) {
  const dims = resolveDimensions({ ...byteAxes, space }, 100, shape);
  for (const axis of Object.values(dims))
    assert.equal(axis.fit, true, "Radial Fit must default on");
  assert.equal(dims.width.naturalEnd, 1);
  assert.equal(dims.height.naturalEnd, 360);
  if (space === "sphere") assert.equal(dims.depth.naturalEnd, 180);
}
for (const value of [
  { width: { mode: "unknown" } },
  { width: { start: 5, end: 4 } },
  { width: { step: 0 } },
  { width: { step: -1 } },
  { width: { fit: "yes" } },
  { width: { end: NaN } },
  [],
])
  assert.throws(() => validateDimensions(value));
assert.throws(() =>
  pointGrid(
    { ...base, dimensions: { width: { start: 0, end: 100000, step: 1 } } },
    10,
    shape,
  ),
);

// Truncating a grid preserves its original strides; Fit only zooms the visible window.
const gridCrop = {
  ...base,
  dimensions: {
    ...base.dimensions,
    width: { start: 0, end: 4, step: 1, fit: true, mode: "truncate" },
  },
};
const cropGrid = pointGrid(gridCrop, 256, shape);
assert.equal(cropGrid.columns, 16);
assert.equal(cropGrid.rows, 16);
const cropOutput = new Float64Array(3),
  cropFactors = new Float64Array(16);
let visible = 0;
const projectCrop = compilePosition(gridCrop, cropGrid.dimensions);
for (let index = 0; index < 256; index++) {
  gridCoordinates(index, cropGrid, cropOutput);
  cropFactors[slots.column] = cropOutput[0];
  cropFactors[slots.row] = cropOutput[1];
  if (projectCrop(cropFactors, xyz)) visible++;
}
assert.equal(
  visible,
  64,
  "Truncation reflowed the grid instead of selecting its columns",
);

// Presets carry coordinate expressions and the compiler never overrides manual axes.
const hilbert = presetConfiguration("hilbert");
assert.equal(hilbert.position[0].input.op, "hilbert");
const program = compileRecipes(
  recipeRoots(hilbert, defaultAppearance("hilbert")),
  {},
);
assert.equal(program.nodes.filter((node) => node.op === "hilbert").length, 1);
assert(program.nodes.some((node) => node.op === "pointIndex"));
const manual = { ...hilbert, position: ["value", "byte2", "slice"] };
assert.equal(recipeRoots(manual, defaultAppearance("hilbert")).p0, "value");

let reads = 0;
class Source extends Blob {
  slice(...args) {
    reads++;
    return super.slice(...args);
  }
}
const source = new Source([
  Uint8Array.from({ length: 256 }, (_, i) => (i * 17 + (i >>> 2)) % 251),
]);
const job = {
  kind: "view",
  source,
  offset: 0,
  length: 128,
  region: "linear",
  configuration: cube,
  sampleLayout: { columns: 16, rows: 8 },
  shaders: [],
  columns: 96,
  rows: 72,
  width: 96,
  height: 72,
  scale: 1,
  pointScale: 1,
};
const plain = {
  ...defaultAppearance("linear"),
  hue: "none",
  lightness: "none",
};
const visit = await pointFactors(job, plain, {}, () => true),
  indices = [];
visit((values, label, context) => indices.push(context.pointIndex));
assert.equal(
  indices.length,
  36,
  "The range product should define the available grid cells",
);
assert(indices.at(-1) > 120, "Grid sampling dropped the tail of the selection");
assert.equal(reads, 0);
for (const population of ["bytes", "pairs", "triples", "bins"]) {
  const cfg = { ...cube, population };
  const canvas = new RenderCanvas(),
    cache = {};
  await executeRender(
    canvas,
    {
      ...job,
      configuration: cfg,
      appearance: { ...plain, lightness: "slice" },
    },
    cache,
  );
  assert(canvas.pixels.some((value, index) => index % 4 !== 3 && value > 0));
  const prepared = cache.preparedPoints;
  await executeRender(
    canvas,
    {
      ...job,
      configuration: cfg,
      appearance: { ...plain, lightness: "slice" },
      rotation: { yaw: 1, pitch: 0.1 },
    },
    cache,
  );
  assert.equal(cache.preparedPoints, prepared);
}
const profile = {
  version: 3,
  region: "linear",
  recipes: {},
  configuration: cube,
  shaders: [],
  coordinateSystem: "cartesian",
  axes: [0, 1],
  rotation: { yaw: 0, pitch: 0 },
  encoding: "ascii",
  blankSpaces: false,
  blankNulls: true,
  frequencyOpacity: false,
};
assert.deepEqual(
  parseProfile(serializeProfile(profile)).configuration.dimensions,
  validateDimensions(cube.dimensions),
);
const old = validateProfile({
  ...profile,
  version: 2,
  configuration: {
    ...cube,
    dimensions: undefined,
    layout: "hilbert3d",
    grid: { columns: 4, rows: 3 },
  },
});
assert.equal(old.version, 3);
assert(!("layout" in old.configuration));
assert(!("grid" in old.configuration));
assert.equal(old.configuration.position[2].input.op, "hilbert3d");
assert.equal(
  old.configuration.dimensions.width.end,
  null,
  "Inactive legacy grid settings should not change Hilbert coordinates",
);
const oldGrid = validateProfile({
  ...profile,
  version: 2,
  configuration: {
    ...cube,
    dimensions: undefined,
    layout: "linear3d",
    grid: { columns: 4, rows: 3 },
  },
});
assert.equal(oldGrid.configuration.dimensions.width.end, 4);
const oldNative = validateProfile({
  ...profile,
  version: 1,
  region: "hilbert",
  configuration: undefined,
  coordinateSystem: "radial",
  axes: [1, 0],
});
assert.equal(oldNative.configuration.space, "circle");
assert.equal(oldNative.configuration.position[0].component, 1);
console.log(
  "Dimension checks pass: ranges/cell counts, independent Cartesian/radial Fit, natural domains, sampling, explicit Hilbert coordinates, validation, profile migration.",
);
