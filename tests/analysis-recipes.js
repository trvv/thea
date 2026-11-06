import assert from "node:assert/strict";
import {
  analysisKinds,
  analysisParameters,
} from "../src/analysis/analysis-parameters.js";
import { compileRecipes, recipeLabel } from "../src/recipes/recipes.js";
import { recipeMenu } from "../src/ui/recipe-menu.js";
import { emitRecipeShader } from "../src/recipes/recipe-shaders.js";
import { validateProfile } from "../src/presets/profiles.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";

const offset = { op: "offset" };
for (const [family, kinds] of Object.entries(analysisKinds)) {
  for (const kind of kinds) {
    const expression = { op: "analysis", offset, family, kind };
    const program = compileRecipes({
      x: expression,
      y: structuredClone(expression),
    });
    assert.equal(
      program.nodes.filter((node) => node.op === "analysis").length,
      1,
    );
    assert.equal(program.providers.analysis.length, 1);
    assert.equal(program.providers.byte, true);
    assert.equal(program.providers.entropy.size, 0);
    assert.equal(program.providers.spectrum.size, 0);
    assert.equal(program.providers.analysis[0].scope, "selection");
    const factors = new Float64Array(program.factorCount);
    let visited;
    program.createEvaluator()(factors, {
      offset: 2 ** 24 + 1,
      analysis: (index, parameters) => {
        visited = { index, parameters };
        return 0.25;
      },
    });
    assert.equal(visited.index, 2 ** 24 + 1);
    assert.equal(visited.parameters.family, family);
    assert.equal(factors[program.bindings.x], 0.25);
    const emitted = emitRecipeShader(program, "glsl");
    assert.equal(emitted.bindings[0].kind, "analysis");
    assert.equal(emitted.bindings[0].projection, kind);
    assert.equal(emitted.bindings[0].family, family);
    assert(emitted.source.includes("offset >= length"));
    assert(!emitRecipeShader(program, "wgsl").source.includes("undefined"));
    assert(recipeLabel(expression).includes(kind));
  }
}
const rawSurprise = {
  op: "analysis",
  offset,
  family: "conditional",
  kind: "surprise",
};
const normalized = compileRecipes({
  x: { op: "normalize", input: rawSurprise, min: 0, max: 32 },
});
const factors = new Float64Array(normalized.factorCount);
normalized.createEvaluator()(factors, { offset: 1, analysis: () => 16 });
assert.equal(
  factors[normalized.bindings.x],
  0.5,
  "Raw surprise must survive until its explicit display mapping",
);
for (const parameters of [
  { family: "unknown" },
  { family: "__proto__" },
  { family: "conditional", kind: "information" },
  { family: "conditional", alpha: 0 },
  { family: "conditional", alpha: -1 },
  { family: "conditional", alpha: Infinity },
  { family: "bit", bit: 8 },
  { family: "distribution", window: 0 },
  { family: "distribution", gap: -1 },
  { family: "lag", lag: 0 },
  { family: "lag", window: 4097 },
  { family: "bit", scope: "root" },
])
  assert.throws(
    () => compileRecipes({ x: { op: "analysis", offset, ...parameters } }),
    TypeError,
  );
assert.doesNotThrow(() =>
  compileRecipes({ x: { op: "analysis", offset, family: "lag", window: 0 } }),
);
assert.throws(
  () =>
    compileRecipes({
      x: {
        op: "analysis",
        offset: { op: "hilbert", input: "position" },
        family: "bit",
      },
    }),
  TypeError,
);
let edited;
const base = recipeMenu("Offset", offset, {}, (value) => {
  edited = value;
});
const statistical = base.items
  .find((item) => item.label === "Transform")
  .items.find((item) => item.label === "Statistical Analysis");
assert.equal(statistical.items.length, Object.keys(analysisKinds).length);
statistical.items.find((item) => item.label === "Lag Comparison").action();
assert.equal(edited.family, "lag");
assert.equal(edited.lag, 1);
const lagMenu = recipeMenu("Lag", edited, {}, (value) => {
  edited = value;
});
lagMenu.items.find((item) => item.label === "Window").action(0);
assert.equal(edited.window, 0);
lagMenu.items.find((item) => item.label === "Projection").action("information");
assert.equal(edited.kind, "information");
assert.equal(analysisParameters({ family: "conditional" }).alpha, 1 / 256);
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
  recipes: { Surprise: rawSurprise },
});
assert.deepEqual(validateProfile(JSON.parse(JSON.stringify(profile))), profile);
console.log(
  "Analysis recipes pass: family/projection validation, request/node sharing, raw scores, exact addresses, menu parameters, persisted definitions and shader provider contracts.",
);
