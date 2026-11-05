/**
 * Serializable expressions lower to a typed, shared DAG. Runtime evaluators and their scratch
 * storage are derived state, never the saved recipe format.
 * @module recipes
 * @see docs/recipes.md
 */
import { spaces } from './spaces.js';
import { appearanceChannels, factorIndices, factorCount } from './factor-catalog.js';

/**
 * These are the portable pieces of a compiled program. Provider sets and runtime
 * factories describe execution but are not part of the saved expression schema.
 * @typedef {'f32'|'index'|'vec2'} RecipeType
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
export const constant = value => ({ op: 'constant', value });
/**
 * Use an explicit reference node so a custom name cannot shadow a built-in factor string.
 */
export const reference = name => ({ op: 'ref', name });
/**
 * Return a scalar projection of a shared vec2 expression; X and Y can intern the same Hilbert
 * operation even after serialization.
 */
export const hilbertCoordinate = (component, input = 'position', order = 0) => ({ op: 'component', component,
 input: { op: 'hilbert', input, order } });
const clamp = value => Math.max(0, Math.min(1, value));
const cache = new Map(), requests = new Map();

/**
 * Start reachability at active display channels only. Hidden Z and none channels must not trigger
 * window statistics.
 */
export function recipeRoots(configuration, appearance) {
 const dimensions = spaces[configuration.space].length;
 const roots = {};
 for (let i = 0; i < dimensions; i++) if (configuration.position[i] !== 'none') roots[`p${i}`] = configuration.position[i];
 for (const channel of appearanceChannels) if (appearance[channel] !== 'none') roots[channel] = appearance[channel];
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
 const requestKey=JSON.stringify([roots,definitions]);
 if(requests.has(requestKey))return requests.get(requestKey);
 const nodes = [], interned = new Map(), active = new Set(), references = new Set();
 const required = new Set(), providers = { byte: false, entropy: new Set(), spectrum: new Set() };
 let visits = 0;
 const scalar = node => { if (!['f32','index'].includes(node.type)) throw new TypeError('Expected a scalar recipe'); return node; };
 const number = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new TypeError('Expected a finite recipe parameter between -1000000 and 1000000');
  return value;
 };
 /** Resolve references before interning so aliases share work, while active-expression and active-name checks reject both kinds of cycles. */
 const build = (expression, depth = 0) => {
  if (depth > 32 || ++visits > 2048) throw new TypeError('Recipe exceeds its complexity limit');
  if (typeof expression === 'string') {
   if (!Object.hasOwn(factorIndices, expression)) throw new TypeError(`Unknown factor: ${expression}`);
   required.add(expression);
   expression = { op: 'factor', name: expression };
  }
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) throw new TypeError('Invalid recipe');
  if (active.has(expression)) throw new TypeError('Recipe contains a cycle');
  active.add(expression);
  const { op } = expression;
  const child = name => build(expression[name], depth + 1);
  let args = [], params = {}, type = 'f32';
  switch (op) {
   case 'ref': {
    const { name } = expression;
    if (typeof name !== 'string' || !Object.hasOwn(definitions, name)) throw new TypeError(`Unknown custom factor: ${name}`);
    if (references.has(name)) throw new TypeError('Custom factors contain a cycle');
    references.add(name); const node = build(definitions[name], depth + 1); references.delete(name); active.delete(expression); return node;
   }
   case 'factor':
    if (!Object.hasOwn(factorIndices, expression.name)) throw new TypeError('Unknown factor');
    params.name = expression.name; required.add(params.name); break;
   case 'constant': params.value = number(expression.value); break;
   case 'offset': case 'length': type = 'index'; break;
   case 'add': case 'subtract': case 'multiply': case 'divide':
    args = [scalar(child('a')), scalar(child('b'))];
    if (op !== 'divide' && args.some(node => node.type === 'index') && args.every(node => node.type === 'index' || node.op === 'constant' && Number.isInteger(node.value))) type = 'index';
    break;
   case 'invert': case 'abs': case 'floor': case 'fract':
    args = [scalar(child('input'))]; break;
   case 'power':
    args = [scalar(child('input'))]; params.exponent = number(expression.exponent);
    if (params.exponent < 0 || params.exponent > 16) throw new TypeError('Power must be between 0 and 16'); break;
   case 'normalize': case 'clamp':
    args = [scalar(child('input'))]; params.min = number(expression.min); params.max = number(expression.max);
    if (params.max <= params.min) throw new TypeError('Maximum must exceed minimum'); break;
   case 'byte':
    args = [scalar(child('offset'))]; providers.byte = true; break;
   case 'entropy':
    args = [scalar(child('offset'))]; params.window = expression.window;
    if (!Number.isInteger(params.window) || params.window < 1 || params.window > 4096) throw new TypeError('Entropy window must be between 1 and 4096');
    providers.entropy.add(params.window); break;
   case 'spectrum':
    args = [scalar(child('input'))]; params.kind = expression.kind;
    if (!['phase','frequency','amplitude'].includes(params.kind)) throw new TypeError('Unknown spectrum component');
    providers.spectrum.add(params.kind); break;
   case 'linear': case 'hilbert':
    args = [scalar(child('input'))]; type = 'vec2';
    if (op === 'hilbert') {
     params.order = expression.order ?? 0;
     if (!Number.isInteger(params.order) || params.order < 0 || params.order > 15) throw new TypeError('Hilbert order must be between 0 (automatic) and 15');
    }
    break;
   case 'component': {
    const input = child('input');
    if (input.type !== 'vec2' || ![0,1].includes(expression.component)) throw new TypeError('Expected X or Y from a coordinate vector');
    args = [input]; params.component = expression.component; break;
   }
   default: throw new TypeError(`Unknown recipe operation: ${op}`);
  }
  const key = JSON.stringify([op, params, args.map(node => node.id)]);
  active.delete(expression);
  if (interned.has(key)) return interned.get(key);
  if (nodes.length >= 256) throw new TypeError('Recipe exceeds 256 operations');
  const node = { id: nodes.length, op, type, args: args.map(node => node.id), ...params };
  nodes.push(node); interned.set(key, node); return node;
 };
 const outputs = {};
 for (const [name, expression] of Object.entries(roots)) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw new TypeError('Invalid recipe output name');
  outputs[name] = scalar(build(expression)).id;
 }
 const key = JSON.stringify([nodes, outputs]);
 if (cache.has(key)) {
  requests.set(requestKey,cache.get(key));if(requests.size>32)requests.delete(requests.keys().next().value);
  return cache.get(key);
 }
 const outputEntries=Object.entries(outputs);
 const bindings = Object.fromEntries(Object.keys(outputs).map((name, i) => [name, factorCount + i]));
 const program = { nodes, outputs, bindings, required, providers, key,
  factorCount: factorCount + Object.keys(outputs).length,
  /**
   * Allocate scratch per evaluator instead of per cached plan: multiple canvases may reuse one IR,
   * but their per-point values must never alias.
   */
  createEvaluator() {
   const values = new Float64Array(nodes.length * 2);
   // Instructions close over resolved slots; no parsing or graph traversal occurs per point.
   const instructions = nodes.map(node => {
    const target = node.id * 2, a = node.args[0] * 2, b = node.args[1] * 2;
    switch (node.op) {
     case 'factor': return factors => { values[target] = factors[factorIndices[node.name]]; };
     case 'constant': return () => { values[target] = node.value; };
     case 'offset': return (_, context) => { values[target] = context.offset; };
     case 'length': return (_, context) => { values[target] = context.length; };
     case 'add': return () => { values[target] = values[a] + values[b]; };
     case 'subtract': return () => { values[target] = values[a] - values[b]; };
     case 'multiply': return () => { values[target] = values[a] * values[b]; };
     case 'divide': return () => { values[target] = values[b] === 0 ? 0 : values[a] / values[b]; };
     case 'invert': return () => { values[target] = 1 - values[a]; };
     case 'abs': return () => { values[target] = Math.abs(values[a]); };
     case 'floor': return () => { values[target] = Math.floor(values[a]); };
     case 'fract': return () => { values[target] = values[a] - Math.floor(values[a]); };
     case 'power': return () => { values[target] = Math.max(0, values[a]) ** node.exponent; };
     case 'normalize': return () => { values[target] = clamp((values[a] - node.min) / (node.max - node.min)); };
     case 'clamp': return () => { values[target] = Math.max(node.min, Math.min(node.max, values[a])); };
     case 'byte': return (_, context) => { values[target] = context.byte(values[a]); };
     case 'entropy': return (_, context) => { values[target] = context.entropy(values[a], node.window); };
     case 'spectrum': return (_, context) => { values[target] = context.spectrum(node.kind, values[a]); };
     case 'component': return () => { values[target] = values[a + node.component]; };
     case 'linear': return (_, context) => {
      const [columns, rows] = context.grid;
      const index = Math.min(columns * rows - 1, Math.floor(clamp(values[a]) * columns * rows));
      values[target] = (index % columns + 0.5) / columns; values[target + 1] = (Math.floor(index / columns) + 0.5) / rows;
     };
     case 'hilbert': return (_, context) => {
      const side = 2 ** (node.order || Math.min(15, Math.ceil(Math.log2(Math.sqrt(Math.max(1, context.length))))));
      let remaining = Math.min(side * side - 1, Math.floor(clamp(values[a]) * side * side)), x = 0, y = 0;
      for (let scale = 1; scale < side; scale *= 2) {
       const rx = Math.floor(remaining / 2) & 1, ry = (remaining ^ rx) & 1;
       if (!ry) { if (rx) { x = scale - 1 - x; y = scale - 1 - y; } [x,y] = [y,x]; }
       x += scale * rx; y += scale * ry; remaining = Math.floor(remaining / 4);
      }
      values[target] = (x + 0.5) / side; values[target + 1] = (y + 0.5) / side;
     };
    }
   });
   return (factors, context) => {
    for (let i = 0; i < instructions.length; i++) {
     instructions[i](factors, context);
     const slot = i * 2;
     // Byte indices retain JS safe-integer precision; visual arithmetic keeps
     // the float32 rounding contract used by shader backends.
     if (nodes[i].type !== 'index') {
      values[slot] = Math.fround(values[slot]);
      if (nodes[i].type === 'vec2') values[slot + 1] = Math.fround(values[slot + 1]);
     } else if (!Number.isSafeInteger(values[slot])) throw new RangeError('Recipe index exceeds the safe integer range');
    }
    for (const [name, id] of outputEntries) {
     const value = values[id * 2]; factors[bindings[name]] = Number.isFinite(value) ? clamp(value) : 0;
    }
   };
  }
 };
 requests.set(requestKey,program);if(requests.size>32)requests.delete(requests.keys().next().value);
 cache.set(key, program); if (cache.size > 32) cache.delete(cache.keys().next().value);
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
 if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) throw new TypeError('Invalid custom factors');
 if (Object.keys(definitions).length > 64) throw new TypeError('Too many custom factors');
 for (const [name, expression] of Object.entries(definitions)) {
  if (!name.trim() || name.length > 64) throw new TypeError('Invalid factor name');
  compileRecipes({ value: expression }, definitions);
 }
 return structuredClone(definitions);
}
/**
 * Summarize expression data for menu state without making the label a parser or an alternative
 * serialization format.
 */
export function recipeLabel(expression) {
 if (typeof expression === 'string') return expression;
 if (!expression) return 'None';
 const input = () => recipeLabel(expression.input);
 switch (expression.op) {
  case 'ref': return expression.name;
  case 'factor': return expression.name;
  case 'constant': return String(expression.value);
  case 'offset': return 'Offset'; case 'length': return 'Length';
  case 'component': return `${input()}.${expression.component === 0 ? 'X' : 'Y'}`;
  case 'hilbert': return `Hilbert(${input()})`; case 'linear': return `Linear(${input()})`;
  case 'byte': return `Byte(${recipeLabel(expression.offset)})`;
  case 'entropy': return `Entropy(${expression.window}, ${recipeLabel(expression.offset)})`;
  case 'spectrum': return `DFT ${expression.kind}(${input()})`;
  case 'normalize': return `Normalize(${input()})`;
  case 'add': case 'subtract': case 'multiply': case 'divide': return `(${recipeLabel(expression.a)} ${{add:'+',subtract:'−',multiply:'×',divide:'÷'}[expression.op]} ${recipeLabel(expression.b)})`;
  default: return `${expression.op}(${input()})`;
 }
}
