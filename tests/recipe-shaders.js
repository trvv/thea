import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { factorCount, factorIndices } from "../factor-catalog.js";
import {
  compileRecipes,
  constant,
  hilbertCoordinate,
  hilbert3DCoordinate,
  mortonCoordinate,
} from "../recipes.js";
import { emitRecipeShader } from "../recipe-shaders.js";
import { numericResult } from "../numeric-interpretation.js";
import { sampleSpectrum } from "../spectrum-sampling.js";
import { spectrumComponents } from "../spectrum.js";
const fixtures = [];
const cases = {
  exactHilbert2D: {
    x: hilbertCoordinate(0, { op: "pointIndex" }),
    y: hilbertCoordinate(1, { op: "pointIndex" }),
    z: constant(0),
    w: constant(1),
  },
  gridFactors: { x: "column", y: "row", z: "slice", w: constant(1) },
  autoHilbert: {
    x: hilbertCoordinate(0),
    y: hilbertCoordinate(1),
    z: "value",
    w: constant(1),
  },
  hilbert3D: {
    x: hilbert3DCoordinate(0),
    y: hilbert3DCoordinate(1),
    z: hilbert3DCoordinate(2),
    w: constant(1),
  },
  hilbert3DScalar: {
    x: hilbert3DCoordinate(0, "position", 3),
    y: hilbert3DCoordinate(1, "position", 3),
    z: hilbert3DCoordinate(2, "position", 3),
    w: constant(1),
  },
  hilbert3DEndpoint: {
    x: hilbert3DCoordinate(0, constant(1), 10),
    y: hilbert3DCoordinate(1, constant(1), 10),
    z: hilbert3DCoordinate(2, constant(1), 10),
    w: constant(1),
  },
  hilbert: {
    x: hilbertCoordinate(0, "position", 3),
    y: hilbertCoordinate(1, "position", 3),
    z: {
      op: "component",
      component: 0,
      input: { op: "linear", input: "position" },
    },
    w: "value",
  },
  arithmetic: {
    x: {
      op: "fract",
      input: { op: "multiply", a: "position", b: constant(3) },
    },
    y: { op: "divide", a: "position", b: constant(0) },
    z: { op: "power", input: "position", exponent: 2 },
    w: {
      op: "abs",
      input: { op: "subtract", a: "position", b: constant(0.5) },
    },
  },
  byte: {
    x: {
      op: "normalize",
      min: 0,
      max: 255,
      input: {
        op: "byte",
        offset: { op: "add", a: { op: "offset" }, b: constant(1) },
      },
    },
    y: { op: "entropy", window: 64, offset: { op: "offset" } },
    z: { op: "spectrum", kind: "phase", input: "position" },
    w: { op: "spectrum", kind: "amplitude", input: "position" },
  },
  other: {
    x: { op: "floor", input: "position" },
    y: {
      op: "clamp",
      input: { op: "invert", input: "position" },
      min: 0.2,
      max: 0.8,
    },
    z: { op: "spectrum", kind: "frequency", input: "position" },
    w: { op: "power", input: constant(0), exponent: 0 },
  },
};
cases.hilbert3DLarge = Object.fromEntries(
  ["x", "y", "z", "w"].map((name, axis) => [
    name,
    axis === 3
      ? constant(1)
      : {
          op: "fract",
          input: {
            op: "multiply",
            a: hilbert3DCoordinate(axis, { op: "offset" }, 10),
            b: constant(128),
          },
        },
  ]),
);
cases.largeIndex = {
  x: {
    op: "normalize",
    min: 0,
    max: 255,
    input: {
      op: "byte",
      offset: { op: "add", a: { op: "offset" }, b: constant(1) },
    },
  },
  y: constant(0),
  z: constant(0),
  w: constant(1),
};
const scaled = (input, max) => ({ op: "normalize", input, min: 0, max });
const read = (offset) => ({ op: "byte", offset });
const offset = { op: "offset" };
const raw = { op: "multiply", a: "value", b: constant(255) };
cases.bits = {
  x: { op: "bit", input: raw, bit: 7 },
  y: scaled({ op: "popcount", input: raw }, 8),
  z: scaled({ op: "xor", a: raw, b: constant(128) }, 255),
  w: scaled(
    { op: "popcount", input: { op: "xor", a: raw, b: constant(128) } },
    8,
  ),
};
cases.bitClamp = {
  x: scaled(
    {
      op: "popcount",
      input: { op: "multiply", a: offset, b: constant(1000000) },
    },
    8,
  ),
  y: scaled({ op: "xor", a: constant(-3.7), b: constant(511.9) }, 255),
  z: { op: "bit", input: constant(127.99), bit: 7 },
  w: scaled({ op: "popcount", input: constant(254.99) }, 8),
};
cases.bitNonfinite = {
  x: scaled({ op: "popcount", input: "value" }, 8),
  y: scaled({ op: "xor", a: "value", b: constant(255) }, 255),
  z: { op: "bit", input: "value", bit: 3 },
  w: scaled({ op: "popcount", input: { op: "abs", input: "value" } }, 8),
};
cases.bitReads = {
  x: scaled(
    {
      op: "xor",
      a: read(offset),
      b: read({ op: "add", a: offset, b: constant(1) }),
    },
    255,
  ),
  y: scaled({ op: "popcount", input: read(offset) }, 8),
  z: { op: "bit", input: read(offset), bit: 2 },
  w: constant(1),
};
cases.available = {
  x: { op: "available", offset, width: 4 },
  y: {
    op: "available",
    offset: { op: "subtract", a: offset, b: constant(1) },
    width: 2,
  },
  z: {
    op: "available",
    offset: { op: "add", a: offset, b: constant(1) },
    width: 8,
  },
  w: constant(1),
};
cases.numeric = {
  x: {
    op: "number",
    offset,
    format: "uint32",
    min: 4294967294,
    max: 4294967295,
  },
  y: { op: "number", offset, format: "uint16", endian: "big" },
  z: { op: "number", offset, format: "int16" },
  w: { op: "number", offset, format: "uint32", kind: "valid" },
};
cases.numericFloat = {
  x: { op: "number", offset, format: "float32", kind: "finite" },
  y: { op: "number", offset, format: "float32", kind: "nan" },
  z: { op: "number", offset, format: "float32", kind: "negativeZero" },
  w: { op: "number", offset, format: "float32", min: -2, max: 2 },
};
cases.numeric64 = {
  x: {
    op: "number",
    offset,
    format: "uint64",
    min: "18446744073709551614",
    max: "18446744073709551615",
  },
  y: { op: "number", offset, format: "int64", kind: "sign" },
  z: { op: "number", offset, format: "float64", kind: "finite" },
  w: {
    op: "number",
    offset,
    format: "float64",
    min: 1 + Number.EPSILON,
    max: 1 + 2 * Number.EPSILON,
  },
};
cases.morton2D = {
  x: mortonCoordinate(0),
  y: mortonCoordinate(1),
  z: constant(0),
  w: constant(1),
};
cases.morton3D = {
  x: mortonCoordinate(0, { op: "pointIndex" }, 0, 3),
  y: mortonCoordinate(1, { op: "pointIndex" }, 0, 3),
  z: mortonCoordinate(2, { op: "pointIndex" }, 0, 3),
  w: constant(1),
};
cases.mortonScalar = {
  x: mortonCoordinate(0, "position", 3, 3),
  y: mortonCoordinate(1, "position", 3, 3),
  z: mortonCoordinate(2, "position", 3, 3),
  w: constant(1),
};
cases.statistical = {
  x: { op: "analysis", offset, family: "lag", kind: "equality", lag: 2 },
  y: {
    op: "normalize",
    input: { op: "analysis", offset, family: "conditional", kind: "surprise" },
    min: 0,
    max: 16,
  },
  z: {
    op: "analysis",
    offset,
    family: "distribution",
    kind: "variation",
    window: 8,
  },
  w: {
    op: "analysis",
    offset: { op: "subtract", a: offset, b: constant(1) },
    family: "bit",
    kind: "bias",
    bit: 3,
  },
};
cases.complexSpectrum = {
  x: {
    op: "spectrum",
    input: "position",
    kind: "phase",
    interpolation: "complex",
  },
  y: {
    op: "spectrum",
    input: "position",
    kind: "amplitude",
    interpolation: "complex",
  },
  z: {
    op: "spectrum",
    input: "position",
    kind: "frequency",
    interpolation: "complex",
  },
  w: constant(1),
};
const complexSpectrum = spectrumComponents(
  {
    real: Float64Array.from({ length: 33 }, (_, index) => (index % 5) - 2),
    imaginary: Float64Array.from({ length: 33 }, (_, index) => (index % 3) - 1),
  },
  64,
  true,
  true,
);
const numericBytes = (format) => {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  if (["uint64", "int64", "float64"].includes(format)) {
    for (let offset = 0; offset < 64; offset += 8)
      if (format === "float64")
        view.setFloat64(
          offset,
          [
            -0,
            Number.MIN_VALUE,
            Number.MAX_VALUE,
            NaN,
            Infinity,
            -Infinity,
            1 + Number.EPSILON,
            1 + 2 * Number.EPSILON,
          ][offset / 8],
          true,
        );
      else
        view.setBigUint64(
          offset,
          18446744073709551614n + BigInt((offset / 8) % 2),
          true,
        );
    return bytes;
  }
  for (let offset = 0; offset < 64; offset += 4)
    if (format === "float32")
      view.setFloat32(
        offset,
        [NaN, Infinity, -Infinity, -0, 0, 1, -1, 2 ** -149][(offset / 4) % 8],
        true,
      );
    else view.setUint32(offset, 4294967294 + ((offset / 4) % 2), true);
  return bytes;
};
for (const [name, roots] of Object.entries(cases)) {
  const large = name === "largeIndex" || name === "hilbert3DLarge";
  const offsetBase = large ? 2 ** 24 : 0,
    selectionLength = large ? 2 ** 24 + 128 : 64;
  const program = compileRecipes(roots),
    shader = emitRecipeShader(program, "glsl");
  const bindings = shader.bindings
    .map((binding) => {
      if (
        binding.kind === "spectrum" &&
        ["real", "imaginary", "peakAmplitude"].includes(binding.component)
      )
        return `float ${binding.name}(int index) { return ${binding.component === "real" ? "float(index % 5 - 2)" : binding.component === "imaginary" ? "float(index % 3 - 1)" : complexSpectrum.peakAmplitude.toExponential(9)}; }`;
      if (binding.kind === "analysis")
        return `float ${binding.name}(int index) { return float(index) / ${binding.projection === "surprise" ? "4.0" : "64.0"}; }`;
      if (binding.kind === "number") {
        const parameters = { ...binding, kind: binding.projection };
        const bytes = numericBytes(binding.format);
        const values = Array.from(
          { length: 64 },
          (_, index) =>
            `if (index == ${index}) return ${Math.fround(numericResult(bytes, index, parameters)).toExponential(9)};`,
        ).join("\n");
        return `float ${binding.name}(int index) { ${values}\nreturn 0.0; }`;
      }
      return `float ${binding.name}(int index) { return ${binding.kind === "byte" ? (large ? "float(index & 255)" : "float(index)") : binding.kind === "entropy" ? "float(index) / 64.0" : binding.component === "phase" ? "float(index) / 32.0" : "1.0 - float(index) / 32.0"}; }`;
    })
    .join("\n");
  const source = `#version 300 es
precision highp float;
precision highp int;
${shader.source}
${bindings}
out vec4 color;
void main(){
 float offset=gl_FragCoord.x-0.5;
 float factors[${factorCount}];for(int i=0;i<${factorCount};i++)factors[i]=0.0;
 factors[0]=${name === "bitNonfinite" ? "uintBitsToFloat(int(offset) % 4 == 0 ? 0x7fc00000u : int(offset) % 4 == 1 ? 0x7f800000u : int(offset) % 4 == 2 ? 0xff800000u : 0x437fe666u)" : "offset/64.0"};factors[2]=offset/64.0;
 factors[${factorIndices.column}]=mod(offset,4.0)/4.0;factors[${factorIndices.row}]=mod(floor(offset/4.0),4.0)/4.0;factors[${factorIndices.slice}]=floor(offset/16.0)/4.0;
 RecipeResult result=evaluateRecipes(factors,int(offset)+${offsetBase},${selectionLength},vec2(8.0,8.0),int(offset),64);
 color=vec4(result.x,result.y,result.z,result.w);
}`;
  const evaluate = program.createEvaluator(),
    factors = new Float64Array(program.factorCount),
    expected = [];
  for (let i = 0; i < 64; i++) {
    factors[0] =
      name === "bitNonfinite"
        ? [NaN, Infinity, -Infinity, 255.9][i % 4]
        : i / 64;
    factors[2] = i / 64;
    factors[factorIndices.column] = (i % 4) / 4;
    factors[factorIndices.row] = (Math.floor(i / 4) % 4) / 4;
    factors[factorIndices.slice] = Math.floor(i / 16) / 4;
    evaluate(factors, {
      offset: i + offsetBase,
      length: selectionLength,
      pointIndex: i,
      pointCount: 64,
      grid: [8, 8],
      byte: (index) => (large ? index & 255 : index < 64 ? index : 0),
      number: (index, parameters) =>
        numericResult(numericBytes(parameters.format), index, parameters),
      analysis: (index, parameters) =>
        index < 0 || index >= selectionLength
          ? 0
          : index / (parameters.kind === "surprise" ? 4 : 64),
      entropy: (index) => index / 64,
      spectrum: (kind, position, interpolation) => {
        if (interpolation === "complex")
          return sampleSpectrum(
            complexSpectrum,
            selectionLength,
            kind,
            position,
            interpolation,
          );
        const index = Math.min(32, Math.floor(position * 33));
        return kind === "frequency"
          ? (2 * index) / 64
          : kind === "phase"
            ? index / 32
            : 1 - index / 32;
      },
    });
    for (const key of ["x", "y", "z", "w"])
      expected.push(Math.round(factors[program.bindings[key]] * 255));
  }
  fixtures.push({ name, source, expected });
  const wgsl = emitRecipeShader(program, "wgsl");
  assert(!wgsl.source.includes("undefined"));
  assert(wgsl.source.includes("fn evaluateRecipes"));
}
const directory = await mkdtemp(join(tmpdir(), "thea-recipe-shaders-"));
try {
  const input = join(directory, "fixtures.json");
  await writeFile(input, JSON.stringify(fixtures));
  const child = Bun.spawn(
    ["python3", new URL("./recipe-glsl.py", import.meta.url).pathname, input],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(await child.exited, 0, err);
  console.log(out.trim());
} finally {
  await rm(directory, { recursive: true, force: true });
}
