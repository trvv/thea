import assert from "node:assert/strict";
import { hCurve } from "../src/math/hcurve.js";
import {
  hCurveCoordinate,
  compileRecipes,
  constant,
} from "../src/recipes/recipes.js";
import { curveTemplate } from "../src/presets/curve-templates.js";
import { recipeMenu } from "../src/ui/recipe-menu.js";
import { emitRecipeShader } from "../src/recipes/recipe-shaders.js";
import { executeRender } from "../src/render/rendering.js";
import { inspectPoint } from "../src/inspection/point-inspection.js";
import { RenderCanvas } from "./render-canvas.js";

const point = new Float64Array(2);
for (let order = 0; order <= 7; order++) {
  const side = 2 ** order,
    cells = side * side,
    seen = new Set();
  let previous;
  for (let index = 0; index < cells; index++) {
    hCurve(index, order, point);
    const x = point[0] * side - 0.5,
      y = point[1] * side - 0.5;
    assert(
      Number.isInteger(x) &&
        Number.isInteger(y) &&
        x >= 0 &&
        x < side &&
        y >= 0 &&
        y < side,
    );
    seen.add(y * side + x);
    if (previous)
      assert.equal(Math.abs(x - previous[0]) + Math.abs(y - previous[1]), 1);
    previous = [x, y];
  }
  assert.equal(seen.size, cells);
  if (order)
    assert.equal(
      Math.abs(previous[0]) + Math.abs(previous[1]),
      1,
      "Compatibility traversal must close next to its origin",
    );
}
// Traversal facts from the pinned CantorDust implementation, not an inverse cache.
const order2 = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 3],
  [1, 2],
  [2, 2],
  [2, 3],
  [3, 3],
  [3, 2],
  [3, 1],
  [3, 0],
  [2, 0],
  [2, 1],
  [1, 1],
  [1, 0],
];
order2.forEach((expected, index) => {
  hCurve(index, 2, point);
  assert.deepEqual(
    [...point].map((value) => value * 4 - 0.5),
    expected,
  );
});
for (const [index, x, y] of [
  [8, 2, 4],
  [15, 0, 7],
  [16, 1, 7],
  [31, 6, 7],
  [32, 7, 7],
  [63, 1, 0],
]) {
  hCurve(index, 3, point);
  assert.deepEqual(
    [...point].map((value) => value * 8 - 0.5),
    [x, y],
  );
}
for (const [index, x, y] of [
  [536870911, 32766, 32767],
  [536870912, 32767, 32767],
  [1073741823, 1, 0],
]) {
  hCurve(index, 15, point);
  assert.deepEqual(
    [...point].map((value) => value * 32768 - 0.5),
    [x, y],
  );
}
for (const [index, order] of [
  [-1, 2],
  [16, 2],
  [0, 16],
  [0, -1],
  [1.5, 2],
])
  assert.throws(() => hCurve(index, order, point));

const program = compileRecipes({
  x: hCurveCoordinate(0),
  y: hCurveCoordinate(1),
});
assert.equal(program.nodes.filter((node) => node.op === "hcurve").length, 1);
assert(
  !program.providers.byte &&
    !program.providers.entropy.size &&
    !program.providers.spectrum.size,
);
const factors = new Float64Array(program.factorCount),
  evaluate = program.createEvaluator();
evaluate(factors, { pointIndex: 2 ** 24, pointCount: 2 ** 30, length: 2 });
const before = [factors[program.bindings.x], factors[program.bindings.y]];
evaluate(factors, { pointIndex: 2 ** 24 + 1, pointCount: 2 ** 30, length: 2 });
assert.equal(
  Math.abs(before[0] - factors[program.bindings.x]) +
    Math.abs(before[1] - factors[program.bindings.y]),
  1 / 32768,
);
assert(!emitRecipeShader(program, "wgsl").source.includes("undefined"));
for (const input of [constant(-1), constant(0), constant(1), constant(2)]) {
  const scalar = compileRecipes({
    x: hCurveCoordinate(0, input, 2),
    y: hCurveCoordinate(1, input, 2),
  });
  const values = new Float64Array(scalar.factorCount);
  scalar.createEvaluator()(values, { length: 16 });
  const expected = input.value <= 0 ? order2[0] : order2[15];
  assert.deepEqual(
    [values[scalar.bindings.x] * 4 - 0.5, values[scalar.bindings.y] * 4 - 0.5],
    expected,
  );
}
let edited;
let menu = recipeMenu("X", { op: "pointIndex" }, {}, (value) => {
  edited = value;
});
menu.items
  .find((item) => item.label === "Transform")
  .items.find((item) => item.label === "H-Curve")
  .items[0].action();
assert.equal(edited.input.op, "hcurve");
menu = recipeMenu("X", edited, {}, (value) => {
  edited = value;
});
assert.equal(menu.items.find((item) => item.label === "Order").max, 15);

const template = curveTemplate("hcurve");
const job = {
  kind: "view",
  source: new Blob([new Uint8Array(16).fill(65)]),
  offset: 0,
  length: 16,
  columns: 64,
  rows: 64,
  region: "linear",
  sampleLayout: { columns: 4, rows: 4 },
  ...template,
};
const cache = {};
await executeRender(new RenderCanvas(), job, cache);
const projected = cache.pointRaster.projected;
const info = await inspectPoint(job, cache, projected[0], projected[1]);
assert(
  info.nodes.some(
    (node) =>
      node.op === "hcurve" && node.resolvedOrder === 2 && node.curveIndex === 0,
  ),
);
assert.equal(cache.preparedPoints.size, 16);
console.log(
  "H-curve passes: pinned orientation, exhaustive bijection/adjacency/closure, exact large indices, shared vector, scalar endpoints, menus and provenance.",
);
