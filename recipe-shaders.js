/**
 * Backend-neutral IR to shader function libraries. Provider bindings and draw/compute pipelines
 * belong to the eventual GPU renderer, not these expressions.
 * @module recipe-shaders
 * @see docs/recipes.md
 */
import { factorIndices as indices, factorCount } from "./factor-catalog.js";
import { numericFormats } from "./numeric-interpretation.js";
import { analysisParameters } from "./analysis-parameters.js";
// Shader libraries, not draw pipelines: the backend supplies source-factor
// attributes and indexed provider functions using textures/storage buffers.
/**
 * Emit each shared node once while keeping array preparation outside point evaluation. Returned
 * bindings describe provider functions the GPU backend must supply; this library alone is not a
 * render pipeline.
 * @param {object} program Validated IR returned by compileRecipes.
 * @param {'glsl'|'wgsl'} language Target syntax; expression semantics and provider indexing remain
 *   shared.
 * @returns {{language: string, source: string, bindings: object[]}} Linkable function library and
 *   required indexed providers.
 */
export function emitRecipeShader(program, language = "glsl") {
  if (!["glsl", "wgsl"].includes(language))
    throw new TypeError("Unknown shader language");
  const wgsl = language === "wgsl",
    scalar = wgsl ? "f32" : "float",
    integer = wgsl ? "i32" : "int",
    vector = wgsl ? "vec2<f32>" : "vec2",
    vector3 = wgsl ? "vec3<f32>" : "vec3",
    integers3 = wgsl ? "vec3<i32>" : "ivec3";
  const literal = (value) =>
    /[.eE]/.test(String(value)) ? String(value) : `${value}.0`;
  const declaration = (type, name, expression) =>
    wgsl
      ? `let ${name}: ${type} = ${expression};`
      : `${type} ${name} = ${expression};`;
  const parameters = (list) =>
    list
      .map(([type, name]) => (wgsl ? `${name}: ${type}` : `${type} ${name}`))
      .join(", ");
  const fn = (type, name, args, body) =>
    wgsl
      ? `fn ${name}(${parameters(args)}) -> ${type} {\n${body}\n}`
      : `${type} ${name}(${parameters(args)}) {\n${body}\n}`;
  const select = (condition, yes, no) =>
    wgsl
      ? `select(${no}, ${yes}, ${condition})`
      : `(${condition} ? ${yes} : ${no})`;
  const asScalar = (id) =>
    program.nodes[id]?.type === "index" ? `${scalar}(r${id})` : `r${id}`;
  const asIndex = (id) =>
    program.nodes[id]?.type === "index"
      ? `r${id}`
      : `${integer}(floor(r${id}))`;
  const unit = (value) => `recipeUnit(${value})`;
  const external = new Map(),
    helpers = new Map();
  helpers.set(
    "unit",
    fn(
      scalar,
      "recipeUnit",
      [[scalar, "v"]],
      `return ${select("abs(v) <= 3.402823466e38", "clamp(v, 0.0, 1.0)", "0.0")};`,
    ),
  );
  /** Generate selection-bounding wrappers independently of storage functions. This keeps CPU lookup semantics portable across textures and buffers. */
  const provider = (kind, parameter) => {
    const suffix =
      kind === "byte"
        ? "Byte"
        : kind === "entropy"
          ? `Entropy${parameter}`
          : `Spectrum${parameter[0].toUpperCase() + parameter.slice(1)}`;
    const name = `recipeRead${suffix}`;
    external.set(name, {
      name,
      kind,
      ...(kind === "entropy"
        ? { window: parameter }
        : kind === "spectrum"
          ? { component: parameter }
          : {}),
      input: "i32",
      output: "f32",
    });
    const wrapper = `recipeSample${suffix}`;
    if (!helpers.has(wrapper)) {
      let body;
      if (kind === "spectrum")
        body = `if (length < 1.0) { return 0.0; }\n${declaration(integer, "bins", `${integer}(floor(length / 2.0)) + 1`)}\n${declaration(integer, "index", `min(bins - 1, ${integer}(floor(clamp(position, 0.0, 1.0) * ${scalar}(bins))))`)}\nreturn ${name}(index);`;
      else
        body = `if (offset < 0 || offset >= length) { return 0.0; }\nreturn ${name}(offset);`;
      helpers.set(
        wrapper,
        fn(
          scalar,
          wrapper,
          [
            [
              kind === "spectrum" ? scalar : integer,
              kind === "spectrum" ? "position" : "offset",
            ],
            [kind === "spectrum" ? scalar : integer, "length"],
          ],
          body,
        ),
      );
    }
    return wrapper;
  };
  const statements = [];
  for (const node of program.nodes) {
    const a = asScalar(node.args[0]),
      b = asScalar(node.args[1]);
    let expression;
    switch (node.op) {
      case "factor":
        expression = `sourceFactors[${programFactorIndex(node.name)}]`;
        break;
      case "constant":
        expression = literal(node.value);
        break;
      case "offset":
        expression = "pointOffset";
        break;
      case "length":
        expression = "selectionLength";
        break;
      case "pointIndex":
        expression = "pointIndex";
        break;
      case "pointCount":
        expression = "pointCount";
        break;
      case "add":
      case "subtract":
      case "multiply":
        expression =
          node.type === "index"
            ? `(${asIndex(node.args[0])} ${{ add: "+", subtract: "-", multiply: "*" }[node.op]} ${asIndex(node.args[1])})`
            : `(${a} ${{ add: "+", subtract: "-", multiply: "*" }[node.op]} ${b})`;
        break;
      case "divide":
        helpers.set(
          "divide",
          fn(
            scalar,
            "recipeDivide",
            [
              [scalar, "a"],
              [scalar, "b"],
            ],
            `if (b == 0.0) { return 0.0; }\nreturn a / b;`,
          ),
        );
        expression = `recipeDivide(${a}, ${b})`;
        break;
      case "invert":
        expression = `(1.0 - ${a})`;
        break;
      case "abs":
      case "floor":
        expression = `${node.op}(${a})`;
        break;
      case "fract":
        expression = `fract(${a})`;
        break;
      case "xor":
      case "bit":
      case "popcount": {
        helpers.set(
          "byteOperand",
          fn(
            integer,
            "recipeByteOperand",
            [[scalar, "value"]],
            `if (!(abs(value) <= 3.402823466e38)) { return 0; }\nreturn ${integer}(floor(clamp(value, 0.0, 255.0)));`,
          ),
        );
        const byte = `recipeByteOperand(${a})`;
        if (node.op === "xor")
          expression = `${scalar}(${byte} ^ recipeByteOperand(${b}))`;
        else if (node.op === "bit")
          expression = `${scalar}((${byte} >> ${wgsl ? `u32(${node.bit})` : node.bit}) & 1)`;
        else {
          const bits = Array.from({ length: 8 }, (_, bit) =>
            bit === 0
              ? "(value & 1)"
              : `((value >> ${wgsl ? `${bit}u` : bit}) & 1)`,
          ).join(" + ");
          helpers.set(
            "popcount",
            fn(
              scalar,
              "recipePopcount",
              [[integer, "value"]],
              `return ${scalar}(${bits});`,
            ),
          );
          expression = `recipePopcount(${byte})`;
        }
        break;
      }
      case "power":
        expression =
          node.exponent === 0
            ? "1.0"
            : `pow(max(0.0, ${a}), ${literal(node.exponent)})`;
        break;
      case "normalize":
        expression = `clamp((${a} - ${literal(node.min)}) / ${literal(node.max - node.min)}, 0.0, 1.0)`;
        break;
      case "clamp":
        expression = `clamp(${a}, ${literal(node.min)}, ${literal(node.max)})`;
        break;
      case "byte":
        expression = `${provider("byte")}(${asIndex(node.args[0])}, selectionLength)`;
        break;
      case "available":
        expression = select(
          `selectionLength >= ${node.width} && ${asIndex(node.args[0])} >= 0 && ${asIndex(node.args[0])} <= selectionLength - ${node.width}`,
          "1.0",
          "0.0",
        );
        break;
      case "number": {
        const name = `recipeReadNumber${node.id}`;
        const width = numericFormats[node.format].width;
        const { format, endian, kind, min, max } = node;
        external.set(name, {
          name,
          kind: "number",
          format,
          endian,
          projection: kind,
          width,
          ...(kind === "normalized" ? { min, max } : {}),
          input: "i32",
          output: "f32",
          normalization: "decode and normalize before f32 conversion",
        });
        const wrapper = `recipeSampleNumber${node.id}`;
        helpers.set(
          wrapper,
          fn(
            scalar,
            wrapper,
            [
              [integer, "offset"],
              [integer, "length"],
            ],
            `if (length < ${width} || offset < 0 || offset > length - ${width}) { return 0.0; }\nreturn ${name}(offset);`,
          ),
        );
        expression = `${wrapper}(${asIndex(node.args[0])}, selectionLength)`;
        break;
      }
      case "analysis": {
        const name = `recipeReadAnalysis${node.id}`;
        const { kind, ...parameters } = analysisParameters(node);
        external.set(name, {
          name,
          kind: "analysis",
          ...parameters,
          projection: kind,
          input: "i32",
          output: "f32",
        });
        const wrapper = `recipeSampleAnalysis${node.id}`;
        helpers.set(
          wrapper,
          fn(
            scalar,
            wrapper,
            [
              [integer, "offset"],
              [integer, "length"],
            ],
            `if (offset < 0 || offset >= length) { return 0.0; }\nreturn ${name}(offset);`,
          ),
        );
        expression = `${wrapper}(${asIndex(node.args[0])}, selectionLength)`;
        break;
      }
      case "entropy":
        expression = `${provider("entropy", node.window)}(${asIndex(node.args[0])}, selectionLength)`;
        break;
      case "spectrum":
        if (node.interpolation === "complex" && node.kind === "frequency")
          expression = `(2.0 * clamp(${a}, 0.0, 1.0) * floor(${scalar}(selectionLength) / 2.0) / max(1.0, ${scalar}(selectionLength)))`;
        else if (node.interpolation === "complex") {
          const coefficient = (component) => {
            const name = `recipeReadSpectrum${component[0].toUpperCase() + component.slice(1)}`;
            external.set(name, {
              name,
              kind: "spectrum",
              component,
              input: "i32",
              output: "f32",
            });
            return name;
          };
          const real = coefficient("real"),
            imaginary = coefficient("imaginary");
          const peak =
            node.kind === "amplitude"
              ? coefficient("peakAmplitude")
              : undefined;
          const name = `recipeComplexSpectrum${node.kind === "phase" ? "Phase" : "Amplitude"}`;
          const body = `if (length < 1) { return 0.0; }
${declaration(integer, "bins", "length / 2 + 1")}
${declaration(scalar, "coordinate", `clamp(position, 0.0, 1.0) * ${scalar}(bins - 1)`)}
${declaration(integer, "lower", `${integer}(floor(coordinate))`)}
${declaration(integer, "upper", "min(bins - 1, lower + 1)")}
${declaration(scalar, "fraction", `coordinate - ${scalar}(lower)`)}
${declaration(scalar, "real", `mix(${real}(lower), ${real}(upper), fraction)`)}
${declaration(scalar, "imaginary", `mix(${imaginary}(lower), ${imaginary}(upper), fraction)`)}
${declaration(scalar, "magnitude", "sqrt(real * real + imaginary * imaginary)")}
${
  node.kind === "phase"
    ? `if (magnitude == 0.0) { return 0.5; }
if (abs(imaginary) < magnitude * 1e-12) { return ${select("real >= 0.0", "0.5", "1.0")}; }
return (${wgsl ? "atan2" : "atan"}(imaginary, real) + ${literal(Math.PI)}) / ${literal(2 * Math.PI)};`
    : `${declaration(scalar, "lowerWeight", select("lower == 0 || lower * 2 == length", "1.0", "2.0"))}
${declaration(scalar, "upperWeight", select("upper == 0 || upper * 2 == length", "1.0", "2.0"))}
${declaration(scalar, "amplitude", `magnitude * mix(lowerWeight, upperWeight, fraction) / ${scalar}(length)`)}
${declaration(scalar, "peak", `${peak}(0)`)}
if (peak <= 0.0 || amplitude < peak * 1e-10) { return 0.0; }
return log(1.0 + amplitude) / log(1.0 + peak);`
}`;
          helpers.set(
            name,
            fn(
              scalar,
              name,
              [
                [scalar, "position"],
                [integer, "length"],
              ],
              body,
            ),
          );
          expression = `${name}(${a}, selectionLength)`;
        } else if (node.kind === "frequency")
          expression = `(2.0 * min(floor(${scalar}(selectionLength) / 2.0), floor(clamp(${a}, 0.0, 1.0) * (floor(${scalar}(selectionLength) / 2.0) + 1.0))) / max(1.0, ${scalar}(selectionLength)))`;
        else
          expression = `${provider("spectrum", node.kind)}(${a}, ${scalar}(selectionLength))`;
        break;
      case "component":
        expression = `${a}.${["x", "y", "z"][node.component]}`;
        break;
      case "linear": {
        helpers.set(
          "linear",
          fn(
            vector,
            "recipeLinear",
            [
              [scalar, "position"],
              [vector, "grid"],
            ],
            `${declaration(scalar, "index", "min(grid.x * grid.y - 1.0, floor(clamp(position, 0.0, 1.0) * grid.x * grid.y))")}\nreturn ${vector}(index - floor(index / grid.x) * grid.x + 0.5, floor(index / grid.x) + 0.5) / grid;`,
          ),
        );
        expression = `recipeLinear(${a}, grid)`;
        break;
      }
      case "morton": {
        const dimensions = node.dimensions;
        const resultType = dimensions === 3 ? vector3 : vector;
        const axesType = wgsl ? `vec${dimensions}<i32>` : `ivec${dimensions}`;
        const variable = (type, name, value) =>
          wgsl
            ? `var ${name}: ${type} = ${value};`
            : `${type} ${name} = ${value};`;
        const shift = (value) => (wgsl ? `u32(${value})` : value);
        const name = `recipeMorton${dimensions}D`;
        helpers.set(
          name,
          fn(
            resultType,
            name,
            [
              [integer, "index"],
              [integer, "order"],
            ],
            `
${variable(axesType, "axes", `${axesType}(0)`)}
for (${variable(integer, "bit", "0")} bit < order; bit += 1) {
 for (${variable(integer, "axis", "0")} axis < ${dimensions}; axis += 1) {
  axes[axis] |= ((index >> ${shift(`(bit * ${dimensions} + axis)`)}) & 1) << ${shift("bit")};
 }
}
return (${resultType}(axes) + ${resultType}(0.5)) / ${scalar}(1 << ${shift("order")});`,
          ),
        );
        const exact = program.nodes[node.args[0]].type === "index";
        const order = `mortonOrder${node.id}`;
        statements.push(
          declaration(
            integer,
            order,
            node.order
              ? String(node.order)
              : `${integer}(min(${literal(Math.floor(30 / dimensions))}, ceil(log2(max(1.0, ${scalar}( ${exact ? "pointCount" : "selectionLength"}))) / ${literal(dimensions)})))`,
          ),
        );
        const cells = `(1 << ${shift(`(${dimensions} * ${order})`)})`;
        const index = exact
          ? `clamp(r${node.args[0]}, 0, ${cells} - 1)`
          : `min(${cells} - 1, ${integer}(floor(clamp(${a}, 0.0, 1.0) * ${scalar}(${cells}))))`;
        expression = `${name}(${index}, ${order})`;
        break;
      }
      case "hilbert3d": {
        const variable = (type, name, value) =>
          wgsl
            ? `var ${name}: ${type} = ${value};`
            : `${type} ${name} = ${value};`;
        const shift = (value) => (wgsl ? `u32(${value})` : value);
        const side = `(1 << ${shift("order")})`;
        helpers.set(
          "hilbert3d",
          fn(
            vector3,
            "recipeHilbert3D",
            [
              [integer, "index"],
              [integer, "order"],
            ],
            `
${variable(integers3, "axes", `${integers3}(0)`)}
for (${variable(integer, "bit", "0")} bit < order; bit += 1) {
 for (${variable(integer, "axis", "0")} axis < 3; axis += 1) {
  axes[axis] |= ((index >> ${shift("(bit * 3 + 2 - axis)")}) & 1) << ${shift("bit")};
 }
}
${declaration(integer, "tail", `axes.z >> ${shift("1")}`)}
axes.z ^= axes.y; axes.y ^= axes.x; axes.x ^= tail;
for (${variable(integer, "scale", "2")} scale < ${side}; scale *= 2) {
 ${declaration(integer, "mask", "scale - 1")}
 for (${variable(integer, "axis", "2")} axis >= 0; axis -= 1) {
  if ((axes[axis] & scale) != 0) { axes.x ^= mask; }
  else {
   ${declaration(integer, "exchange", "(axes.x ^ axes[axis]) & mask")}
   axes.x ^= exchange; axes[axis] ^= exchange;
  }
 }
}
return (${vector3}(axes) + ${vector3}(0.5)) / ${scalar}(${side});`,
          ),
        );
        const order = `hilbertOrder${node.id}`;
        statements.push(
          declaration(
            integer,
            order,
            node.order
              ? String(node.order)
              : `${integer}(min(10.0, ceil(log2(max(1.0, ${scalar}(pointCount))) / 3.0)))`,
          ),
        );
        const cells = `(1 << ${shift(`(3 * ${order})`)})`;
        const index =
          program.nodes[node.args[0]].type === "index"
            ? `clamp(r${node.args[0]}, 0, ${cells} - 1)`
            : `min(${cells} - 1, ${integer}(floor(clamp(${a}, 0.0, 1.0) * ${scalar}(${cells}))))`;
        expression = `recipeHilbert3D(${index}, ${order})`;
        break;
      }
      case "hcurve": {
        const variable = (name, value) =>
          wgsl
            ? `var ${name}: ${integer} = ${value};`
            : `${integer} ${name} = ${value};`;
        const body = [
          variable("t", "index"),
          variable("n", "side"),
          variable("x", "0"),
          variable("y", "0"),
          variable("sx", "1"),
          variable("sy", "1"),
          `for (${variable("level", "0")} level < 16; level++) {`,
          declaration(integer, "triangle", "n * n / 2"),
          "if (n > 1 && t >= triangle) { x += sx * (n - 1); y += sy * (n - 1); sx = -sx; sy = -sy; t -= triangle; }",
          "if (t < 2) { y += sy * t; break; }",
          declaration(integer, "part", "4 * t / triangle"),
          "if (part == 1) { t = triangle / 2 - 1 - t; y += sy * (n - 1); sy = -sy; }",
          "else if (part == 2) { t = 3 * triangle / 4 - 1 - t; x += sx * (n / 2 - 1); sx = -sx; y += sy * (n / 2); }",
          "else if (part == 3) { t -= 3 * triangle / 4; x += sx * (n / 2); y += sy * (n / 2); }",
          "n /= 2;",
          "}",
          `return (${vector}(${scalar}(x), ${scalar}(y)) + ${vector}(0.5)) / ${scalar}(side);`,
        ].join("\n");
        helpers.set(
          "hcurve",
          fn(
            vector,
            "recipeHCurve",
            [
              [integer, "index"],
              [integer, "side"],
            ],
            body,
          ),
        );
        const exact = program.nodes[node.args[0]].type === "index";
        const count = exact ? "pointCount" : "selectionLength";
        const side = node.order
          ? String(2 ** node.order)
          : `${integer}(exp2(min(15.0, ceil(log2(sqrt(max(1.0, ${scalar}(${count}))))))))`;
        const index = exact
          ? `clamp(r${node.args[0]}, 0, (${side}) * (${side}) - 1)`
          : `min((${side}) * (${side}) - 1, ${integer}(floor(${unit(a)} * ${scalar}((${side}) * (${side})))))`;
        expression = `recipeHCurve(${index}, ${side})`;
        break;
      }
      case "hilbert": {
        const variable = (type, name, value) =>
          wgsl
            ? `var ${name}: ${type} = ${value};`
            : `${type} ${name} = ${value};`;
        const swap = wgsl
          ? "let swap = x; x = y; y = swap;"
          : "int swap = x; x = y; y = swap;";
        helpers.set(
          "hilbert",
          fn(
            vector,
            "recipeHilbert",
            [
              [integer, "index"],
              [integer, "side"],
            ],
            `${variable(integer, "t", "index")}\n${variable(integer, "x", "0")}\n${variable(integer, "y", "0")}\nfor (${variable(integer, "scale", "1")} scale < side; scale *= 2) {\n${declaration(integer, "rx", "(t / 2) & 1")}\n${declaration(integer, "ry", "(t ^ rx) & 1")}\nif (ry == 0) { if (rx == 1) { x = scale - 1 - x; y = scale - 1 - y; } ${swap} }\nx += scale * rx; y += scale * ry; t /= 4;\n}\nreturn (${vector}(${scalar}(x), ${scalar}(y)) + ${vector}(0.5)) / ${scalar}(side);`,
          ),
        );
        const exact = program.nodes[node.args[0]].type === "index";
        const count = exact ? "pointCount" : "selectionLength";
        const side = node.order
          ? String(2 ** node.order)
          : `${integer}(exp2(min(15.0, ceil(log2(sqrt(max(1.0, ${scalar}(${count}))))))))`;
        const index = exact
          ? `clamp(r${node.args[0]}, 0, (${side}) * (${side}) - 1)`
          : `min((${side}) * (${side}) - 1, ${integer}(floor(clamp(${a}, 0.0, 1.0) * ${scalar}((${side}) * (${side})))))`;
        expression = `recipeHilbert(${index}, ${side})`;
        break;
      }
      default:
        throw new TypeError("Unsupported shader operation");
    }
    statements.push(
      declaration(
        node.type === "vec3"
          ? vector3
          : node.type === "vec2"
            ? vector
            : node.type === "index"
              ? integer
              : scalar,
        `r${node.id}`,
        expression,
      ),
    );
  }
  const outputs = Object.keys(program.outputs),
    fields = outputs.length ? outputs : ["unused"];
  const struct = wgsl
    ? `struct RecipeResult { ${fields.map((name) => `${name}: f32,`).join(" ")} }`
    : `struct RecipeResult { ${fields.map((name) => `float ${name};`).join(" ")} };`;
  if (wgsl)
    statements.push(
      `return RecipeResult(${outputs.length ? outputs.map((name) => unit(asScalar(program.outputs[name]))).join(", ") : "0.0"});`,
    );
  else {
    statements.push("RecipeResult result;");
    for (const name of fields)
      statements.push(
        `result.${name} = ${outputs.length ? unit(asScalar(program.outputs[name])) : "0.0"};`,
      );
    statements.push("return result;");
  }
  const args = wgsl
    ? [
        [`array<f32, ${factorCount}>`, "sourceFactors"],
        [integer, "pointOffset"],
        [integer, "selectionLength"],
        [vector, "grid"],
        [integer, "pointIndex"],
        [integer, "pointCount"],
      ]
    : [
        [`float`, `sourceFactors[${factorCount}]`],
        [integer, "pointOffset"],
        [integer, "selectionLength"],
        [vector, "grid"],
        [integer, "pointIndex"],
        [integer, "pointCount"],
      ];
  const prototypes = wgsl
    ? ""
    : Array.from(
        external.values(),
        (binding) => `float ${binding.name}(int index);`,
      ).join("\n");
  return {
    language,
    maxIndex: 2147483647,
    bindings: [...external.values()],
    source: [
      struct,
      prototypes,
      ...helpers.values(),
      fn("RecipeResult", "evaluateRecipes", args, statements.join("\n")),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
/**
 * Use the canonical slot ABI instead of duplicating numeric source indices in shader generation.
 */
function programFactorIndex(name) {
  return indices[name];
}
