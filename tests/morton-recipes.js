import assert from "node:assert/strict";
import {
  compileRecipes,
  mortonCoordinate,
  constant,
} from "../src/recipes/recipes.js";
import { emitRecipeShader } from "../src/recipes/recipe-shaders.js";
import { recipeMenu } from "../src/ui/recipe-menu.js";

for (const dimensions of [2, 3]) {
  for (const order of [1, 2, 3]) {
    const roots = Object.fromEntries(
      Array.from({ length: dimensions }, (_, axis) => [
        `p${axis}`,
        mortonCoordinate(axis, { op: "pointIndex" }, order, dimensions),
      ]),
    );
    const program = compileRecipes(roots);
    assert.equal(
      program.nodes.filter((node) => node.op === "morton").length,
      1,
    );
    assert.equal(program.providers.byte, false);
    const evaluate = program.createEvaluator();
    const factors = new Float64Array(program.factorCount);
    const visited = new Set();
    const side = 2 ** order,
      cells = side ** dimensions;
    for (let index = 0; index < cells; index++) {
      evaluate(factors, { pointIndex: index, pointCount: cells, length: 99 });
      const axes = Array.from(
        { length: dimensions },
        (_, axis) => factors[program.bindings[`p${axis}`]] * side - 0.5,
      );
      let reference = 0;
      for (let bit = 0; bit < order; bit++)
        for (let axis = 0; axis < dimensions; axis++)
          reference +=
            ((axes[axis] >>> bit) & 1) * 2 ** (bit * dimensions + axis);
      assert.equal(reference, index);
      assert(
        axes.every(
          (value) => Number.isInteger(value) && value >= 0 && value < side,
        ),
      );
      visited.add(axes.join(","));
    }
    assert.equal(visited.size, cells);
    assert(!emitRecipeShader(program, "wgsl").source.includes("undefined"));
  }
}
const program = compileRecipes({
  x: mortonCoordinate(0, { op: "pointIndex" }, 15),
  y: mortonCoordinate(1, { op: "pointIndex" }, 15),
});
const evaluate = program.createEvaluator();
const factors = new Float64Array(program.factorCount);
evaluate(factors, { pointIndex: 2 ** 24, pointCount: 2 ** 30 });
const before = factors[program.bindings.x];
evaluate(factors, { pointIndex: 2 ** 24 + 1, pointCount: 2 ** 30 });
assert.equal(factors[program.bindings.x] - before, 1 / 32768);
const endpoint = compileRecipes({ x: mortonCoordinate(0, constant(1), 3, 3) });
const values = new Float64Array(endpoint.factorCount);
endpoint.createEvaluator()(values, { length: 512 });
assert.equal(values[endpoint.bindings.x], 7.5 / 8);
for (const dimensions of [0, 1, 4, 2.5])
  assert.throws(() =>
    compileRecipes({ x: mortonCoordinate(0, constant(0), 1, dimensions) }),
  );
for (const order of [-1, 16, 1.2])
  assert.throws(() =>
    compileRecipes({ x: mortonCoordinate(0, constant(0), order) }),
  );
assert.throws(() =>
  compileRecipes({ x: mortonCoordinate(2, constant(0), 1, 2) }),
);
let edited;
const menu = recipeMenu("X", { op: "pointIndex" }, {}, (value) => {
  edited = value;
});
menu.items
  .find((item) => item.label === "Transform")
  .items.find((item) => item.label === "Morton 3D")
  .items.find((item) => item.label === "Z")
  .action();
assert.equal(edited.input.dimensions, 3);
assert.equal(edited.component, 2);
assert.equal(
  recipeMenu("Z", edited, {}, () => {}).items.find(
    (item) => item.label === "Order",
  ).max,
  10,
);
console.log(
  "Morton recipes pass: exhaustive cell uniqueness/interleaving, vector sharing, exact large indices, endpoint clipping, menu controls and emitted interfaces.",
);
