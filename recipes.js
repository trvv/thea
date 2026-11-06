/**
 * Serializable expressions lower to a typed, shared DAG. Runtime evaluators and their scratch
 * storage are derived state, never the saved recipe format.
 * @module recipes
 * @see docs/recipes.md
 */
import { hilbert3D, hilbert3DMaxOrder } from "./hilbert.js";
import { spaces } from "./spaces.js";
import { numericParameters, spanAvailable } from "./numeric-interpretation.js";
import {
  appearanceChannels,
  factorIndices,
  factorCount,
} from "./factor-catalog.js";

/**
 * These are the portable pieces of a compiled program. Provider sets and runtime
 * factories describe execution but are not part of the saved expression schema.
 * @typedef {'f32'|'index'|'vec2'|'vec3'} RecipeType
 * @typedef {object} RecipeNode
 * @property {number} id Topological position in the program's node array.
 * @property {string} op Validated operation name; never executable source text.
 * @property {RecipeType} type
 * @property {number[]} args IDs of input nodes, always preceding this node.
 * @see docs/recipes.md
 */

/**
 * Keep literals as data so the saved expression can travel to workers and shader emitters
 * unchanged.
 */
export const constant = (value) => ({ op: "constant", value });
/**
 * Use an explicit reference node so a custom name cannot shadow a built-in factor string.
 */
export const reference = (name) => ({ op: "ref", name });
/**
 * Return a scalar projection of a shared vec2 expression; X and Y can intern the same Hilbert
 * operation even after serialization.
 */
export const hilbertCoordinate = (
  component,
  input = "position",
  order = 0,
) => ({ op: "component", component, input: { op: "hilbert", input, order } });
/** A true cube traversal; integer inputs select exact cells, scalar inputs span the curve. */
export const hilbert3DCoordinate = (
  component,
  input = { op: "pointIndex" },
  order = 0,
) => ({ op: "component", component, input: { op: "hilbert3d", input, order } });
/** Morton/Z-order coordinates are independent explicit mappings, with X using the low bit. */
export const mortonCoordinate = (
  component,
  input = { op: "pointIndex" },
  order = 0,
  dimensions = 2,
) => ({
  op: "component",
  component,
  input: { op: "morton", input, order, dimensions },
});
const clamp = (value) => Math.max(0, Math.min(1, value));
// Bit operations consume raw byte units, never implicit normalized-factor values.
const byteOperand = (value) =>
  Number.isFinite(value) ? Math.floor(Math.max(0, Math.min(255, value))) : 0;
const cache = new Map(),
  requests = new Map();

/**
 * Start reachability at active display channels only. Hidden Z and none channels must not trigger
 * window statistics.
 */
export function recipeRoots(configuration, appearance) {
  const dimensions = spaces[configuration.space].length;
  const roots = {},
    position = configuration.position;
  for (let i = 0; i < dimensions; i++)
    if (position[i] !== "none") roots[`p${i}`] = position[i];
  for (const channel of appearanceChannels)
    if (appearance[channel] !== "none") roots[channel] = appearance[channel];
  return roots;
}

// This is the portable IR. It contains data and typed operations, never user code.
// Interning identical nodes gives both backends a shared, topologically ordered DAG.
/**
 * Validate and intern expressions into a topologically ordered scalar/index/vector DAG. Cache by expression
 * data so fresh structured clones reuse plans without depending on object identity.
 * @returns {object} Typed nodes, outputs, provider requirements, synthetic factor bindings, and an
 *   evaluator factory. The runtime factory is not serializable recipe state.
 */
export function compileRecipes(roots, definitions = {}) {
  const requestKey = JSON.stringify([roots, definitions]);
  if (requests.has(requestKey)) return requests.get(requestKey);
  const nodes = [],
    interned = new Map(),
    active = new Set(),
    references = new Set();
  const required = new Set(),
    providers = { byte: false, entropy: new Set(), spectrum: new Set() };
  let visits = 0;
  const scalar = (node) => {
    if (!["f32", "index"].includes(node.type))
      throw new TypeError("Expected a scalar recipe");
    return node;
  };
  const number = (value) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > 1e6
    )
      throw new TypeError(
        "Expected a finite recipe parameter between -1000000 and 1000000",
      );
    return value;
  };
  /** Resolve references before interning so aliases share work, while active-expression and active-name checks reject both kinds of cycles. */
  const build = (expression, depth = 0) => {
    if (depth > 32 || ++visits > 2048)
      throw new TypeError("Recipe exceeds its complexity limit");
    if (typeof expression === "string") {
      if (!Object.hasOwn(factorIndices, expression))
        throw new TypeError(`Unknown factor: ${expression}`);
      required.add(expression);
      expression = { op: "factor", name: expression };
    }
    if (
      !expression ||
      typeof expression !== "object" ||
      Array.isArray(expression)
    )
      throw new TypeError("Invalid recipe");
    if (active.has(expression)) throw new TypeError("Recipe contains a cycle");
    active.add(expression);
    const { op } = expression;
    const child = (name) => build(expression[name], depth + 1);
    let args = [],
      params = {},
      type = "f32";
    switch (op) {
      case "ref": {
        const { name } = expression;
        if (typeof name !== "string" || !Object.hasOwn(definitions, name))
          throw new TypeError(`Unknown custom factor: ${name}`);
        if (references.has(name))
          throw new TypeError("Custom factors contain a cycle");
        references.add(name);
        const node = build(definitions[name], depth + 1);
        references.delete(name);
        active.delete(expression);
        return node;
      }
      case "factor":
        if (!Object.hasOwn(factorIndices, expression.name))
          throw new TypeError("Unknown factor");
        params.name = expression.name;
        required.add(params.name);
        break;
      case "constant":
        params.value = number(expression.value);
        break;
      case "offset":
      case "length":
      case "pointIndex":
      case "pointCount":
        type = "index";
        break;
      case "add":
      case "subtract":
      case "multiply":
      case "divide":
        args = [scalar(child("a")), scalar(child("b"))];
        if (
          op !== "divide" &&
          args.some((node) => node.type === "index") &&
          args.every(
            (node) =>
              node.type === "index" ||
              (node.op === "constant" && Number.isInteger(node.value)),
          )
        )
          type = "index";
        break;
      case "invert":
      case "abs":
      case "floor":
      case "fract":
        args = [scalar(child("input"))];
        break;
      case "xor":
        args = [scalar(child("a")), scalar(child("b"))];
        break;
      case "bit":
        params.bit = expression.bit;
        if (!Number.isInteger(params.bit) || params.bit < 0 || params.bit > 7)
          throw new TypeError("Bit index must be between 0 and 7");
        args = [scalar(child("input"))];
        break;
      case "popcount":
        args = [scalar(child("input"))];
        break;
      case "power":
        args = [scalar(child("input"))];
        params.exponent = number(expression.exponent);
        if (params.exponent < 0 || params.exponent > 16)
          throw new TypeError("Power must be between 0 and 16");
        break;
      case "normalize":
      case "clamp":
        args = [scalar(child("input"))];
        params.min = number(expression.min);
        params.max = number(expression.max);
        if (params.max <= params.min)
          throw new TypeError("Maximum must exceed minimum");
        break;
      case "byte":
        args = [scalar(child("offset"))];
        providers.byte = true;
        break;
      case "available":
        args = [scalar(child("offset"))];
        params.width = expression.width ?? 1;
        if (
          !Number.isInteger(params.width) ||
          params.width < 1 ||
          params.width > 8
        )
          throw new TypeError("Span width must be between 1 and 8");
        break;
      case "number":
        args = [scalar(child("offset"))];
        params = numericParameters(expression);
        providers.byte = true;
        providers.numeric = true;
        break;
      case "entropy":
        args = [scalar(child("offset"))];
        params.window = expression.window;
        if (
          !Number.isInteger(params.window) ||
          params.window < 1 ||
          params.window > 4096
        )
          throw new TypeError("Entropy window must be between 1 and 4096");
        providers.entropy.add(params.window);
        break;
      case "spectrum":
        args = [scalar(child("input"))];
        params.kind = expression.kind;
        if (!["phase", "frequency", "amplitude"].includes(params.kind))
          throw new TypeError("Unknown spectrum component");
        providers.spectrum.add(params.kind);
        break;
      case "linear":
      case "hilbert":
        args = [scalar(child("input"))];
        type = "vec2";
        if (op === "hilbert") {
          params.order = expression.order ?? 0;
          if (
            !Number.isInteger(params.order) ||
            params.order < 0 ||
            params.order > 15
          )
            throw new TypeError(
              "Hilbert order must be between 0 (automatic) and 15",
            );
        }
        break;
      case "hilbert3d":
        args = [scalar(child("input"))];
        type = "vec3";
        params.order = expression.order ?? 0;
        if (
          !Number.isInteger(params.order) ||
          params.order < 0 ||
          params.order > hilbert3DMaxOrder
        )
          throw new TypeError(
            "3D Hilbert order must be between 0 (automatic) and 10",
          );
        break;
      case "morton":
        args = [scalar(child("input"))];
        params.dimensions = expression.dimensions ?? 2;
        if (params.dimensions !== 2 && params.dimensions !== 3)
          throw new TypeError("Morton dimensions must be 2 or 3");
        params.order = expression.order ?? 0;
        if (
          !Number.isInteger(params.order) ||
          params.order < 0 ||
          params.order > Math.floor(30 / params.dimensions)
        )
          throw new TypeError("Morton order exceeds its 30-bit curve limit");
        type = `vec${params.dimensions}`;
        break;
      case "component": {
        const input = child("input");
        if (
          !["vec2", "vec3"].includes(input.type) ||
          !Number.isInteger(expression.component) ||
          expression.component < 0 ||
          expression.component >= Number(input.type.slice(3))
        )
          throw new TypeError("Invalid coordinate vector component");
        args = [input];
        params.component = expression.component;
        break;
      }
      default:
        throw new TypeError(`Unknown recipe operation: ${op}`);
    }
    const key = JSON.stringify([op, params, args.map((node) => node.id)]);
    active.delete(expression);
    if (interned.has(key)) return interned.get(key);
    if (nodes.length >= 256)
      throw new TypeError("Recipe exceeds 256 operations");
    const node = {
      id: nodes.length,
      op,
      type,
      args: args.map((node) => node.id),
      ...params,
    };
    nodes.push(node);
    interned.set(key, node);
    return node;
  };
  const outputs = {};
  for (const [name, expression] of Object.entries(roots)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name))
      throw new TypeError("Invalid recipe output name");
    outputs[name] = scalar(build(expression)).id;
  }
  const key = JSON.stringify([nodes, outputs]);
  if (cache.has(key)) {
    requests.set(requestKey, cache.get(key));
    if (requests.size > 32) requests.delete(requests.keys().next().value);
    return cache.get(key);
  }
  const outputEntries = Object.entries(outputs);
  const bindings = Object.fromEntries(
    Object.keys(outputs).map((name, i) => [name, factorCount + i]),
  );
  const program = {
    nodes,
    outputs,
    bindings,
    required,
    providers,
    key,
    factorCount: factorCount + Object.keys(outputs).length,
    /**
     * Allocate scratch per evaluator instead of per cached plan: multiple canvases may reuse one IR,
     * but their per-point values must never alias.
     */
    createEvaluator(trace) {
      // Source-only graphs are common in arbitrary configurations. Lower their outputs directly,
      // preserving the same float32/clamp contract without interpreter scratch or instruction calls.
      if (
        !trace &&
        nodes.every((node) => node.op === "factor" || node.op === "constant")
      ) {
        const outputs = outputEntries.map(([name, id]) => ({
          target: bindings[name],
          source:
            nodes[id].op === "factor" ? factorIndices[nodes[id].name] : -1,
          value: nodes[id].value,
        }));
        return (factors) => {
          for (let i = 0; i < outputs.length; i++) {
            const output = outputs[i],
              value = Math.fround(
                output.source < 0 ? output.value : factors[output.source],
              );
            factors[output.target] = Number.isFinite(value) ? clamp(value) : 0;
          }
        };
      }
      const slots = [];
      let size = 0;
      for (const node of nodes) {
        slots.push(size);
        size += node.type === "vec3" ? 3 : node.type === "vec2" ? 2 : 1;
      }
      const values = new Float64Array(size);
      // Instructions close over resolved slots; no parsing or graph traversal occurs per point.
      const instructions = nodes.map((node) => {
        const target = slots[node.id],
          a = slots[node.args[0]],
          b = slots[node.args[1]];
        switch (node.op) {
          case "factor":
            return (factors) => {
              values[target] = factors[factorIndices[node.name]];
            };
          case "constant":
            return () => {
              values[target] = node.value;
            };
          case "offset":
            return (_, context) => {
              values[target] = context.offset;
            };
          case "length":
            return (_, context) => {
              values[target] = context.length;
            };
          case "pointIndex":
            return (_, context) => {
              values[target] = context.pointIndex;
            };
          case "pointCount":
            return (_, context) => {
              values[target] = context.pointCount;
            };
          case "add":
            return () => {
              values[target] = values[a] + values[b];
            };
          case "subtract":
            return () => {
              values[target] = values[a] - values[b];
            };
          case "multiply":
            return () => {
              values[target] = values[a] * values[b];
            };
          case "divide":
            return () => {
              values[target] = values[b] === 0 ? 0 : values[a] / values[b];
            };
          case "invert":
            return () => {
              values[target] = 1 - values[a];
            };
          case "abs":
            return () => {
              values[target] = Math.abs(values[a]);
            };
          case "floor":
            return () => {
              values[target] = Math.floor(values[a]);
            };
          case "fract":
            return () => {
              values[target] = values[a] - Math.floor(values[a]);
            };
          case "xor":
            return () => {
              values[target] = byteOperand(values[a]) ^ byteOperand(values[b]);
            };
          case "bit":
            return () => {
              values[target] = (byteOperand(values[a]) >> node.bit) & 1;
            };
          case "popcount":
            return () => {
              let byte = byteOperand(values[a]);
              byte -= (byte >> 1) & 0x55;
              byte = (byte & 0x33) + ((byte >> 2) & 0x33);
              values[target] = (byte + (byte >> 4)) & 0x0f;
            };
          case "power":
            return () => {
              values[target] = Math.max(0, values[a]) ** node.exponent;
            };
          case "normalize":
            return () => {
              values[target] = clamp(
                (values[a] - node.min) / (node.max - node.min),
              );
            };
          case "clamp":
            return () => {
              values[target] = Math.max(
                node.min,
                Math.min(node.max, values[a]),
              );
            };
          case "byte":
            return (_, context) => {
              values[target] = context.byte(values[a]);
            };
          case "available":
            return (_, context) => {
              values[target] = spanAvailable(
                values[a],
                node.width,
                context.length,
              )
                ? 1
                : 0;
            };
          case "number":
            return (_, context) => {
              values[target] = context.number(values[a], node);
            };
          case "entropy":
            return (_, context) => {
              values[target] = context.entropy(values[a], node.window);
            };
          case "spectrum":
            return (_, context) => {
              values[target] = context.spectrum(node.kind, values[a]);
            };
          case "component":
            return () => {
              values[target] = values[a + node.component];
            };
          case "linear":
            return (_, context) => {
              const [columns, rows] = context.grid;
              const index = Math.min(
                columns * rows - 1,
                Math.floor(clamp(values[a]) * columns * rows),
              );
              values[target] = ((index % columns) + 0.5) / columns;
              values[target + 1] = (Math.floor(index / columns) + 0.5) / rows;
            };
          case "hilbert3d":
            return (_, context) => {
              if (Number.isNaN(values[a])) {
                values[target] = values[target + 1] = values[target + 2] = NaN;
                return;
              }
              const order =
                node.order ||
                Math.min(
                  hilbert3DMaxOrder,
                  Math.ceil(
                    Math.log2(
                      Math.max(1, context.pointCount ?? context.length),
                    ) / 3,
                  ),
                );
              const cells = 2 ** (order * 3);
              const index =
                nodes[node.args[0]].type === "index"
                  ? Math.max(0, Math.min(cells - 1, values[a]))
                  : Math.min(cells - 1, Math.floor(clamp(values[a]) * cells));
              hilbert3D(index, order, values, target);
            };
          case "morton":
            return (_, context) => {
              if (Number.isNaN(values[a])) {
                for (let axis = 0; axis < node.dimensions; axis++)
                  values[target + axis] = NaN;
                return;
              }
              const exact = nodes[node.args[0]].type === "index";
              const count = exact
                ? (context.pointCount ?? context.length)
                : context.length;
              const order =
                node.order ||
                Math.min(
                  Math.floor(30 / node.dimensions),
                  Math.ceil(Math.log2(Math.max(1, count)) / node.dimensions),
                );
              const side = 2 ** order;
              const cells = side ** node.dimensions;
              let index = exact
                ? Math.max(0, Math.min(cells - 1, values[a]))
                : Math.min(cells - 1, Math.floor(clamp(values[a]) * cells));
              for (let axis = 0; axis < node.dimensions; axis++)
                values[target + axis] = 0;
              for (let bit = 0; bit < order; bit++) {
                for (let axis = 0; axis < node.dimensions; axis++) {
                  values[target + axis] += (index % 2) * 2 ** bit;
                  index = Math.floor(index / 2);
                }
              }
              for (let axis = 0; axis < node.dimensions; axis++)
                values[target + axis] = (values[target + axis] + 0.5) / side;
            };
          case "hilbert":
            return (_, context) => {
              const exact = nodes[node.args[0]].type === "index";
              const count = exact
                ? (context.pointCount ?? context.length)
                : context.length;
              const side =
                2 **
                (node.order ||
                  Math.min(
                    15,
                    Math.ceil(Math.log2(Math.sqrt(Math.max(1, count)))),
                  ));
              let remaining = exact
                  ? Math.max(0, Math.min(side * side - 1, values[a]))
                  : Math.min(
                      side * side - 1,
                      Math.floor(clamp(values[a]) * side * side),
                    ),
                x = 0,
                y = 0;
              for (let scale = 1; scale < side; scale *= 2) {
                const rx = Math.floor(remaining / 2) & 1,
                  ry = (remaining ^ rx) & 1;
                if (!ry) {
                  if (rx) {
                    x = scale - 1 - x;
                    y = scale - 1 - y;
                  }
                  [x, y] = [y, x];
                }
                x += scale * rx;
                y += scale * ry;
                remaining = Math.floor(remaining / 4);
              }
              values[target] = (x + 0.5) / side;
              values[target + 1] = (y + 0.5) / side;
            };
        }
      });
      return (factors, context) => {
        for (let i = 0; i < instructions.length; i++) {
          instructions[i](factors, context);
          const slot = slots[i];
          // Byte indices retain JS safe-integer precision; visual arithmetic keeps
          // the float32 rounding contract used by shader backends.
          if (nodes[i].type !== "index") {
            values[slot] = Math.fround(values[slot]);
            if (nodes[i].type === "vec2" || nodes[i].type === "vec3")
              values[slot + 1] = Math.fround(values[slot + 1]);
            if (nodes[i].type === "vec3")
              values[slot + 2] = Math.fround(values[slot + 2]);
          } else if (!Number.isSafeInteger(values[slot]))
            throw new RangeError("Recipe index exceeds the safe integer range");
          if (trace)
            trace(
              nodes[i],
              nodes[i].type === "vec3"
                ? Array.from(values.subarray(slot, slot + 3))
                : nodes[i].type === "vec2"
                  ? Array.from(values.subarray(slot, slot + 2))
                  : values[slot],
            );
        }
        for (const [name, id] of outputEntries) {
          const value = values[slots[id]];
          factors[bindings[name]] = Number.isFinite(value) ? clamp(value) : 0;
        }
      };
    },
  };
  requests.set(requestKey, program);
  if (requests.size > 32) requests.delete(requests.keys().next().value);
  cache.set(key, program);
  if (cache.size > 32) cache.delete(cache.keys().next().value);
  return program;
}

/**
 * Require a scalar terminal before accepting a mapping; callers receive an owned clone rather than
 * a mutable alias.
 */
export function validateRecipe(expression, definitions = {}) {
  compileRecipes({ value: expression }, definitions);
  return structuredClone(expression);
}
/**
 * Check unused named definitions too, so a later reference cannot activate a latent cycle or
 * invalid operation.
 */
export function validateDefinitions(definitions = {}) {
  if (
    !definitions ||
    typeof definitions !== "object" ||
    Array.isArray(definitions)
  )
    throw new TypeError("Invalid custom factors");
  if (Object.keys(definitions).length > 64)
    throw new TypeError("Too many custom factors");
  for (const [name, expression] of Object.entries(definitions)) {
    if (!name.trim() || name.length > 64)
      throw new TypeError("Invalid factor name");
    compileRecipes({ value: expression }, definitions);
  }
  return structuredClone(definitions);
}
/**
 * Summarize expression data for menu state without making the label a parser or an alternative
 * serialization format.
 */
export function recipeLabel(expression) {
  if (typeof expression === "string") return expression;
  if (!expression) return "None";
  const input = () => recipeLabel(expression.input);
  switch (expression.op) {
    case "ref":
      return expression.name;
    case "factor":
      return expression.name;
    case "constant":
      return String(expression.value);
    case "offset":
      return "Offset";
    case "length":
      return "Length";
    case "pointIndex":
      return "Point Index";
    case "pointCount":
      return "Point Count";
    case "component":
      return `${input()}.${["X", "Y", "Z"][expression.component]}`;
    case "hilbert3d":
      return `Hilbert3D(${input()})`;
    case "morton":
      return `Morton${expression.dimensions ?? 2}D(${input()})`;
    case "hilbert":
      return `Hilbert(${input()})`;
    case "linear":
      return `Linear(${input()})`;
    case "byte":
      return `Byte(${recipeLabel(expression.offset)})`;
    case "available":
      return `Available(${expression.width ?? 1}, ${recipeLabel(expression.offset)})`;
    case "number":
      return `${expression.format ?? "uint16"} ${expression.kind ?? "normalized"}(${recipeLabel(expression.offset)})`;
    case "entropy":
      return `Entropy(${expression.window}, ${recipeLabel(expression.offset)})`;
    case "spectrum":
      return `DFT ${expression.kind}(${input()})`;
    case "bit":
      return `Bit ${expression.bit}(${input()})`;
    case "popcount":
      return `Popcount(${input()})`;
    case "xor":
      return `XOR(${recipeLabel(expression.a)}, ${recipeLabel(expression.b)})`;
    case "normalize":
      return `Normalize(${input()})`;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      return `(${recipeLabel(expression.a)} ${{ add: "+", subtract: "−", multiply: "×", divide: "÷" }[expression.op]} ${recipeLabel(expression.b)})`;
    default:
      return `${expression.op}(${input()})`;
  }
}
