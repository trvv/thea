import assert from "node:assert/strict";
import {
  numericParameters,
  numericResult,
  interpretNumber,
} from "../numeric-interpretation.js";
import { compileRecipes } from "../recipes.js";
import { emitRecipeShader } from "../recipe-shaders.js";
import { recipeMenu } from "../recipe-menu.js";
import { pointFactors } from "../point-factors.js";
import { presetConfiguration } from "../point-configuration.js";
import { defaultAppearance } from "../appearance.js";

for (const [format, getter, values] of [
  [
    "uint64",
    "getBigUint64",
    [0n, 1n, 2n ** 53n + 1n, 2n ** 63n, 2n ** 64n - 2n, 2n ** 64n - 1n],
  ],
  [
    "int64",
    "getBigInt64",
    [-(2n ** 63n), -(2n ** 53n) - 1n, -1n, 0n, 1n, 2n ** 63n - 1n],
  ],
])
  for (const endian of ["little", "big"]) {
    const parameters = numericParameters({ format, endian });
    for (const value of values) {
      const bytes = new Uint8Array(10);
      new DataView(bytes.buffer)[getter.replace("get", "set")](
        1,
        value,
        endian === "little",
      );
      const unaligned = bytes.subarray(1, 9);
      const interpretation = interpretNumber(unaligned, 0, parameters);
      assert.equal(interpretation.rawValue, value.toString());
      assert.equal(interpretation.finite, true);
      assert.equal(interpretation.rawBits.length, 18);
      assert.doesNotThrow(() => JSON.stringify(interpretation));
      const expected =
        Number(value - BigInt(parameters.min)) /
        Number(BigInt(parameters.max) - BigInt(parameters.min));
      assert.equal(numericResult(unaligned, 0, parameters), expected);
      assert.equal(
        numericResult(unaligned, 0, { ...parameters, kind: "finite" }),
        1,
      );
      assert.equal(
        numericResult(unaligned, 0, { ...parameters, kind: "sign" }),
        value < 0n ? 1 : 0,
      );
      assert.equal(numericResult(unaligned, 1, parameters), 0);
    }
  }
const adjacent = new Uint8Array(16);
const view = new DataView(adjacent.buffer);
view.setBigUint64(0, 18446744073709551614n, true);
view.setBigUint64(8, 18446744073709551615n, true);
const parameters = numericParameters({
  format: "uint64",
  min: "18446744073709551614",
  max: "18446744073709551615",
});
assert.equal(numericResult(adjacent, 0, parameters), 0);
assert.equal(numericResult(adjacent, 8, parameters), 1);
const expression = { op: "number", offset: { op: "offset" }, ...parameters };
const program = compileRecipes({ x: expression });
const factors = new Float64Array(program.factorCount);
program.createEvaluator()(factors, {
  offset: 8,
  number: (index, parameters) => numericResult(adjacent, index, parameters),
});
assert.equal(factors[program.bindings.x], 1);
assert.deepEqual(JSON.parse(JSON.stringify(expression)), expression);
assert.equal(emitRecipeShader(program).bindings[0].min, parameters.min);
assert(!emitRecipeShader(program, "wgsl").source.includes("undefined"));

for (const endian of ["little", "big"])
  for (const value of [
    -Infinity,
    -Number.MAX_VALUE,
    -0,
    0,
    Number.MIN_VALUE,
    1.0000000000000002,
    Number.MAX_VALUE,
    Infinity,
    NaN,
  ]) {
    const bytes = new Uint8Array(9);
    new DataView(bytes.buffer).setFloat64(1, value, endian === "little");
    const params = numericParameters({
      format: "float64",
      endian,
      min: 0,
      max: Number.MAX_VALUE,
    });
    const interpreted = interpretNumber(bytes.subarray(1), 0, params);
    assert.equal(
      interpreted.rawValue,
      Object.is(value, -0)
        ? "-0"
        : Number.isFinite(value)
          ? value
          : String(value),
    );
    assert.equal(interpreted.rawBits.length, 18);
    assert.equal(
      numericResult(bytes.subarray(1), 0, { ...params, kind: "negativeZero" }),
      Object.is(value, -0) ? 1 : 0,
    );
  }
const floatBits = new Uint8Array(8);
new DataView(floatBits.buffer).setBigUint64(0, 0xfff8000000000001n, true);
const floatParameters = numericParameters({ format: "float64", kind: "nan" });
assert.equal(
  interpretNumber(floatBits, 0, floatParameters).rawBits,
  "0xFFF8000000000001",
);
assert.equal(
  numericResult(floatBits, 0, { ...floatParameters, kind: "nan" }),
  1,
);
assert.equal(
  numericResult(floatBits, 0, { ...floatParameters, kind: "sign" }),
  1,
);
assert.equal(
  numericResult(floatBits, 0, { ...floatParameters, kind: "exponent" }),
  1,
);
assert.equal(
  numericResult(floatBits, 0, { ...floatParameters, kind: "fraction" }),
  Number(0x8000000000001n) / 4503599627370495,
);
const neighboringFloats = new Uint8Array(16);
new DataView(neighboringFloats.buffer).setFloat64(0, 1 + Number.EPSILON, true);
new DataView(neighboringFloats.buffer).setFloat64(
  8,
  1 + 2 * Number.EPSILON,
  true,
);
const floatNarrow = numericParameters({
  format: "float64",
  min: 1 + Number.EPSILON,
  max: 1 + 2 * Number.EPSILON,
});
assert.equal(numericResult(neighboringFloats, 0, floatNarrow), 0);
assert.equal(numericResult(neighboringFloats, 8, floatNarrow), 1);
for (const invalid of [
  { min: 0 },
  { min: 0n },
  { min: "00" },
  { min: "-0" },
  { min: " 0" },
  { min: "+1" },
  { min: "-1" },
  { max: "18446744073709551616" },
  { min: "2", max: "1" },
])
  assert.throws(() => numericParameters({ format: "uint64", ...invalid }));
assert.throws(() =>
  numericParameters({ format: "int64", min: "-9223372036854775809" }),
);
assert.throws(() => numericParameters({ format: "float64" }));

let edited;
const menu = recipeMenu("64-bit", expression, {}, (value) => {
  edited = value;
});
const minimum = menu.items.find((item) => item.label === "Minimum");
assert.equal(minimum.input, "text");
minimum.action("18446744073709551613");
assert.equal(edited.min, "18446744073709551613");
assert.doesNotThrow(() => compileRecipes({ x: edited }));
const cache = {};
const visit = await pointFactors(
  {
    source: new Blob([adjacent]),
    offset: 0,
    length: adjacent.length,
    region: "linear",
    shaders: [],
    columns: 64,
    rows: 64,
    configuration: {
      ...presetConfiguration("linear"),
      sampling: "representative",
      sampleLimit: 2,
    },
    sampleLayout: { columns: 2, rows: 1 },
  },
  defaultAppearance("linear", []),
  cache,
  () => true,
  program,
);
const evaluate = program.createEvaluator(),
  results = [];
visit((factors, label, context) => {
  evaluate(factors, context);
  results.push(factors[program.bindings.x]);
});
assert.deepEqual(results, [0, 1]);
console.log(
  "64-bit numeric checks pass: exact integer strings/bounds, pre-f32 BigInt normalization, endian/unaligned reads, float64 special values and raw fields, JSON/shader contracts, menus and providers.",
);
