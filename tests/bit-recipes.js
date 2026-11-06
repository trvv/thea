import assert from "node:assert/strict";
import {
  compileRecipes,
  constant,
  recipeLabel,
  validateRecipe,
} from "../src/recipes/recipes.js";
import { recipeMenu } from "../src/ui/recipe-menu.js";
import { factorIndices } from "../src/recipes/factor-catalog.js";
import { validateProfile } from "../src/presets/profiles.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";

const normalize = (input, max) => ({ op: "normalize", input, min: 0, max });
const byte = (offset) => ({ op: "byte", offset: constant(offset) });
const changed = { op: "xor", a: byte(0), b: byte(1) };
const population = { op: "popcount", input: changed };
const roots = {
  xor: normalize(changed, 255),
  hamming: normalize(population, 8),
  population: normalize({ op: "popcount", input: byte(0) }, 8),
  ...Object.fromEntries(
    Array.from({ length: 8 }, (_, bit) => [
      `bit${bit}`,
      { op: "bit", input: byte(0), bit },
    ]),
  ),
};
const program = compileRecipes(roots);
const factors = new Float64Array(program.factorCount);
const evaluate = program.createEvaluator();
const countBits = (value) => value.toString(2).replaceAll("0", "").length;
let left = 0,
  right = 0;
const context = { byte: (index) => (index === 0 ? left : right) };
for (left = 0; left < 256; left++) {
  for (right = 0; right < 256; right++) {
    evaluate(factors, context);
    assert.equal(
      factors[program.bindings.xor],
      Math.fround((left ^ right) / 255),
    );
    assert.equal(
      factors[program.bindings.hamming],
      countBits(left ^ right) / 8,
    );
    assert.equal(factors[program.bindings.population], countBits(left) / 8);
    for (let bit = 0; bit < 8; bit++)
      assert.equal(factors[program.bindings[`bit${bit}`]], (left >> bit) & 1);
  }
}
assert.equal(program.nodes.filter((node) => node.op === "xor").length, 1);
assert.equal(program.nodes.filter((node) => node.op === "byte").length, 2);
assert.equal(program.providers.byte, true);
assert.equal(program.providers.entropy.size, 0);
assert.equal(program.providers.spectrum.size, 0);
const noRead = compileRecipes({ x: { op: "popcount", input: constant(255) } });
assert.equal(noRead.providers.byte, false);
const policies = compileRecipes({
  count: normalize({ op: "popcount", input: "value" }, 8),
  xor: normalize({ op: "xor", a: "value", b: constant(0) }, 255),
  bit: { op: "bit", input: "value", bit: 7 },
});
const policyFactors = new Float64Array(policies.factorCount);
const policyEvaluate = policies.createEvaluator();
for (const [input, expected] of [
  [-Infinity, 0],
  [Infinity, 0],
  [NaN, 0],
  [-7.9, 0],
  [0.99, 0],
  [1.99, 1],
  [127.99, 127],
  [128.99, 128],
  [255.9, 255],
  [2 ** 40, 255],
]) {
  policyFactors[factorIndices.value] = input;
  policyEvaluate(policyFactors, {});
  assert.equal(policyFactors[policies.bindings.count], countBits(expected) / 8);
  assert.equal(
    policyFactors[policies.bindings.xor],
    Math.fround(expected / 255),
  );
  assert.equal(policyFactors[policies.bindings.bit], (expected >> 7) & 1);
}
// Exact index operands must clamp before any 32-bit coercion wraps their value.
const indexed = compileRecipes({
  x: normalize({ op: "popcount", input: { op: "offset" } }, 8),
});
const indexedFactors = new Float64Array(indexed.factorCount);
indexed.createEvaluator()(indexedFactors, { offset: 2 ** 40 });
assert.equal(indexedFactors[indexed.bindings.x], 1);
for (const bit of [-1, 8, 1.5, NaN, undefined, "1"])
  assert.throws(() => validateRecipe({ op: "bit", input: constant(1), bit }));
assert.throws(() => validateRecipe({ op: "xor", a: constant(1) }));
assert.throws(() =>
  validateRecipe({
    op: "popcount",
    input: { op: "hilbert", input: "position" },
  }),
);
const rawTrace = [];
const traceProgram = compileRecipes({ x: normalize(population, 8) });
traceProgram.createEvaluator((node, value) => rawTrace.push([node.op, value]))(
  new Float64Array(traceProgram.factorCount),
  { byte: (index) => (index === 0 ? 0x7f : 0x80) },
);
assert(rawTrace.some(([op, value]) => op === "xor" && value === 255));
assert(rawTrace.some(([op, value]) => op === "popcount" && value === 8));
assert.equal(
  recipeLabel({ op: "bit", input: byte(0), bit: 3 }),
  "Bit 3(Byte(0))",
);
assert.equal(recipeLabel(population), "Popcount(XOR(Byte(0), Byte(1)))");
let edit;
const menu = recipeMenu("Hue", byte(0), {}, (next) => {
  edit = next;
});
const transformations = menu.items.find(
  (item) => item.label === "Transform",
).items;
for (const [label, op] of [
  ["Bit", "bit"],
  ["Population Count", "popcount"],
  ["Byte XOR", "xor"],
]) {
  transformations.find((item) => item.label === label).action();
  assert.equal(edit.op, op);
  validateRecipe(edit);
}
const bitMenu = recipeMenu(
  "Hue",
  { op: "bit", input: byte(0), bit: 3 },
  {},
  (next) => {
    edit = next;
  },
);
const bitParameter = bitMenu.items.find((item) => item.label === "Bit");
assert.equal(bitParameter.min, 0);
assert.equal(bitParameter.max, 7);
assert.equal(bitParameter.step, 1);
bitParameter.action(5);
assert.equal(edit.bit, 5);
const profile = validateProfile({
  version: 3,
  region: "linear",
  shaders: [],
  coordinateSystem: "cartesian",
  axes: [0, 1],
  rotation: { yaw: 0, pitch: 0 },
  encoding: "ascii",
  blankSpaces: false,
  blankNulls: false,
  frequencyOpacity: false,
  configuration: presetConfiguration("linear"),
  recipes: { hamming: normalize(population, 8) },
});
assert.deepEqual(
  validateProfile(JSON.parse(JSON.stringify(profile))).recipes,
  profile.recipes,
);
console.log(
  "Bit recipe checks pass: exhaustive bytes/pairs, conversion policy, exact indices, DAG reuse, raw traces, menu controls and profile round trips.",
);
