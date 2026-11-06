import assert from "node:assert/strict";
import {
  numericFormats,
  numericKinds,
  numericParameters,
  numericResult,
  interpretNumber,
  spanAvailable,
} from "../src/analysis/numeric-interpretation.js";
import { compileRecipes } from "../src/recipes/recipes.js";
import { emitRecipeShader } from "../src/recipes/recipe-shaders.js";
import { recipeMenu } from "../src/ui/recipe-menu.js";
import { validateProfile } from "../src/presets/profiles.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { pointFactors } from "../src/data/point-factors.js";

const fixtures = {
  uint16: [0, 1, 255, 256, 32768, 65534, 65535],
  int16: [-32768, -1, 0, 1, 32767],
  uint32: [0, 1, 16777217, 2147483648, 4294967294, 4294967295],
  int32: [-2147483648, -16777217, -1, 0, 1, 16777217, 2147483647],
  float32: [-Infinity, -3.5, -0, 0, 2 ** -149, 3.5, Infinity, NaN],
};
for (const [format, values] of Object.entries(fixtures)) {
  const definition = numericFormats[format];
  for (const endian of ["little", "big"]) {
    for (const value of values) {
      const storage = new Uint8Array(definition.width + 4);
      const view = new DataView(storage.buffer);
      view[definition.getter.replace("get", "set")](
        1,
        value,
        endian === "little",
      );
      const bytes = storage.subarray(1, 1 + definition.width);
      const parameters = numericParameters({
        format,
        endian,
        ...(format === "float32" ? { min: -4, max: 4 } : {}),
      });
      const result = interpretNumber(bytes, 0, parameters);
      assert(result.valid);
      assert.equal(
        result.rawValue,
        Object.is(value, -0)
          ? "-0"
          : Number.isFinite(value)
            ? value
            : String(value),
      );
      assert.equal(result.finite, Number.isFinite(value));
      assert.equal(result.negativeZero, Object.is(value, -0));
      const expected = Number.isFinite(value)
        ? Math.max(
            0,
            Math.min(
              1,
              (value - parameters.min) / (parameters.max - parameters.min),
            ),
          )
        : 0;
      assert.equal(numericResult(bytes, 0, parameters), expected);
      assert.equal(
        numericResult(bytes, 0, { ...parameters, kind: "valid" }),
        1,
      );
      assert.equal(numericResult(bytes, -1, parameters), 0);
      assert.equal(numericResult(bytes, 1, parameters), 0);
      assert.equal(
        interpretNumber(bytes.subarray(1), 0, parameters).valid,
        false,
      );
      const program = compileRecipes({
        x: { op: "number", offset: { op: "offset" }, ...parameters },
      });
      const factors = new Float64Array(program.factorCount);
      program.createEvaluator()(factors, {
        offset: 0,
        length: bytes.length,
        number: (offset, parameters) =>
          numericResult(bytes, offset, parameters),
      });
      assert.equal(factors[program.bindings.x], Math.fround(expected));
      assert.equal(program.providers.numeric, true);
    }
  }
}

// Normalize before float32: neighboring large unsigned values must not collapse first.
const adjacent = new Uint8Array(8);
new DataView(adjacent.buffer).setUint32(0, 4294967294, true);
new DataView(adjacent.buffer).setUint32(4, 4294967295, true);
const narrow = numericParameters({
  format: "uint32",
  min: 4294967294,
  max: 4294967295,
});
assert.equal(numericResult(adjacent, 0, narrow), 0);
assert.equal(numericResult(adjacent, 4, narrow), 1);
assert.equal(interpretNumber(adjacent, 0, narrow).rawValue, 4294967294);
assert.equal(interpretNumber(adjacent, 4, narrow).rawValue, 4294967295);
const floatBits = new Uint8Array(4);
new DataView(floatBits.buffer).setUint32(0, 0xffc00001, true);
assert.equal(
  numericResult(floatBits, 0, {
    format: "float32",
    endian: "little",
    kind: "nan",
  }),
  1,
);
assert.equal(
  numericResult(floatBits, 0, {
    format: "float32",
    endian: "little",
    kind: "sign",
  }),
  1,
);
assert.equal(
  numericResult(floatBits, 0, {
    format: "float32",
    endian: "little",
    kind: "exponent",
  }),
  1,
);
assert.equal(
  interpretNumber(floatBits, 0, {
    format: "float32",
    endian: "little",
    kind: "nan",
  }).rawBits,
  "0xFFC00001",
);

for (const expression of [
  { format: "bad" },
  { format: "__proto__" },
  { endian: "native" },
  { kind: "value" },
  { format: "float32" },
  { min: 1, max: 1 },
  { min: NaN, max: 1 },
  { min: -Number.MAX_VALUE, max: Number.MAX_VALUE },
  { kind: "fraction", format: "uint32" },
])
  assert.throws(() => numericParameters(expression), TypeError);
for (const width of [0, 9, 1.5, NaN])
  assert.throws(() =>
    compileRecipes({ x: { op: "available", offset: { op: "offset" }, width } }),
  );
for (const index of [-1, NaN, Infinity, 4])
  assert.equal(spanAvailable(index, 2, 4), false);
assert.equal(spanAvailable(2, 2, 4), true);
assert.equal(spanAvailable(2 ** 24 + 1, 4, 2 ** 24 + 5), true);
const availability = compileRecipes({
  x: { op: "available", offset: { op: "offset" }, width: 4 },
});
assert.equal(availability.providers.byte, false);
const factors = new Float64Array(availability.factorCount);
availability.createEvaluator()(factors, {
  offset: 2 ** 24 + 1,
  length: 2 ** 24 + 5,
});
assert.equal(factors[availability.bindings.x], 1);

const expression = { op: "number", offset: { op: "offset" }, ...narrow };
const shader = emitRecipeShader(compileRecipes({ x: expression }), "glsl");
assert.equal(shader.bindings[0].format, "uint32");
assert.equal(shader.bindings[0].min, 4294967294);
assert.equal(shader.bindings[0].projection, "normalized");
assert(shader.source.includes("offset > length - 4"));
assert(
  !emitRecipeShader(compileRecipes({ x: expression }), "wgsl").source.includes(
    "undefined",
  ),
);
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
  recipes: {},
  appearance: { ...defaultAppearance("linear"), lightness: expression },
});
assert.deepEqual(validateProfile(JSON.parse(JSON.stringify(profile))), profile);
let changed;
const menu = recipeMenu("Numeric", expression, {}, (value) => {
  changed = value;
});
menu.items.find((item) => item.label === "Byte Order").action("big");
assert.equal(changed.endian, "big");
menu.items.find((item) => item.label === "Projection").action("valid");
assert.equal(changed.kind, "valid");
const basic = recipeMenu("Offset", { op: "offset" }, {}, (value) => {
  changed = value;
});
basic.items
  .find((item) => item.label === "Transform")
  .items.find((item) => item.label === "Read Number")
  .items.find((item) => item.label === "float32")
  .action();
assert.doesNotThrow(() => compileRecipes({ x: changed }));
assert(numericKinds.includes("finite"));
const preparedProgram = compileRecipes({ x: expression });
const providerCache = {};
const visit = await pointFactors(
  {
    source: new Blob([Uint8Array.of(99, 88, 77), adjacent]),
    offset: 3,
    length: 8,
    columns: 8,
    rows: 8,
    region: "linear",
    shaders: [],
    configuration: {
      ...presetConfiguration("linear"),
      sampling: "representative",
      sampleLimit: 2,
    },
    sampleLayout: { columns: 2, rows: 1 },
  },
  defaultAppearance("linear", []),
  providerCache,
  () => true,
  preparedProgram,
);
const preparedValues = [];
const evaluatePrepared = preparedProgram.createEvaluator();
visit((factors, label, context) => {
  evaluatePrepared(factors, context);
  preparedValues.push(factors[preparedProgram.bindings.x]);
});
assert.deepEqual(preparedValues, [0, 1]);
assert.equal(providerCache.factorWindow.data.length, 8);
assert.equal(providerCache.factorSpectrum, undefined);
assert.equal(providerCache.factorEntropy, undefined);
console.log(
  "Numeric recipes pass: native endian/unaligned reads, full spans, exact pre-f32 normalization, float classifications/bits, validity, large offsets, menus, profiles and shader descriptors.",
);
