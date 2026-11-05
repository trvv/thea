/**
 * Backend-neutral IR to shader function libraries. Provider bindings and draw/compute pipelines
 * belong to the eventual GPU renderer, not these expressions.
 * @module recipe-shaders
 * @see docs/recipes.md
 */
import { factorIndices as indices, factorCount } from './factor-catalog.js';
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
export function emitRecipeShader(program, language = 'glsl') {
 if (!['glsl','wgsl'].includes(language)) throw new TypeError('Unknown shader language');
 const wgsl = language === 'wgsl', scalar = wgsl ? 'f32' : 'float', integer = wgsl ? 'i32' : 'int', vector = wgsl ? 'vec2<f32>' : 'vec2';
 const literal = value => /[.eE]/.test(String(value)) ? String(value) : `${value}.0`;
 const declaration = (type, name, expression) => wgsl ? `let ${name}: ${type} = ${expression};` : `${type} ${name} = ${expression};`;
 const parameters = list => list.map(([type,name]) => wgsl ? `${name}: ${type}` : `${type} ${name}`).join(', ');
 const fn = (type,name,args,body) => wgsl ? `fn ${name}(${parameters(args)}) -> ${type} {\n${body}\n}` : `${type} ${name}(${parameters(args)}) {\n${body}\n}`;
 const select = (condition,yes,no) => wgsl ? `select(${no}, ${yes}, ${condition})` : `(${condition} ? ${yes} : ${no})`;
 const unit = value => `recipeUnit(${value})`;
 const external = new Map(), helpers = new Map();
 helpers.set('unit', fn(scalar,'recipeUnit',[[scalar,'v']],`return ${select('abs(v) <= 3.402823466e38','clamp(v, 0.0, 1.0)','0.0')};`));
 /** Generate selection-bounding wrappers independently of storage functions. This keeps CPU lookup semantics portable across textures and buffers. */
 const provider = (kind,parameter) => {
  const suffix=kind==='byte'?'Byte':kind==='entropy'?`Entropy${parameter}`:`Spectrum${parameter[0].toUpperCase()+parameter.slice(1)}`;
  const name=`recipeRead${suffix}`;
  external.set(name,{name,kind,...(kind==='entropy'?{window:parameter}:kind==='spectrum'?{component:parameter}:{}),input:'i32',output:'f32'});
  const wrapper=`recipeSample${suffix}`;
  if(!helpers.has(wrapper)) {
   let body;
   if(kind==='spectrum')body=`if (length < 1.0) { return 0.0; }\n${declaration(integer,'bins',`${integer}(floor(length / 2.0)) + 1`)}\n${declaration(integer,'index',`min(bins - 1, ${integer}(floor(clamp(position, 0.0, 1.0) * ${scalar}(bins))))`)}\nreturn ${name}(index);`;
   else body=`if (offset < 0.0 || offset >= length) { return 0.0; }\nreturn ${name}(${integer}(floor(offset)));`;
   helpers.set(wrapper,fn(scalar,wrapper,[[scalar,kind==='spectrum'?'position':'offset'],[scalar,'length']],body));
  }
  return wrapper;
 };
 const statements=[];
 for(const node of program.nodes) {
  const a=`r${node.args[0]}`, b=`r${node.args[1]}`;let expression;
  switch(node.op){
   case 'factor': expression=`sourceFactors[${programFactorIndex(node.name)}]`;break;
   case 'constant':expression=literal(node.value);break;
   case 'offset':expression='pointOffset';break;
   case 'length':expression='selectionLength';break;
   case 'add':case 'subtract':case 'multiply':expression=`(${a} ${{add:'+',subtract:'-',multiply:'*'}[node.op]} ${b})`;break;
   case 'divide':
    helpers.set('divide',fn(scalar,'recipeDivide',[[scalar,'a'],[scalar,'b']],`if (b == 0.0) { return 0.0; }\nreturn a / b;`));expression=`recipeDivide(${a}, ${b})`;break;
   case 'invert':expression=`(1.0 - ${a})`;break;
   case 'abs':case 'floor':expression=`${node.op}(${a})`;break;
   case 'fract':expression=`fract(${a})`;break;
   case 'power':expression=node.exponent===0?'1.0':`pow(max(0.0, ${a}), ${literal(node.exponent)})`;break;
   case 'normalize':expression=`clamp((${a} - ${literal(node.min)}) / ${literal(node.max-node.min)}, 0.0, 1.0)`;break;
   case 'clamp':expression=`clamp(${a}, ${literal(node.min)}, ${literal(node.max)})`;break;
   case 'byte':expression=`${provider('byte')}(${a}, selectionLength)`;break;
   case 'entropy':expression=`${provider('entropy',node.window)}(${a}, selectionLength)`;break;
   case 'spectrum':
    if(node.kind==='frequency')expression=`(2.0 * min(floor(selectionLength / 2.0), floor(clamp(${a}, 0.0, 1.0) * (floor(selectionLength / 2.0) + 1.0))) / max(1.0, selectionLength))`;
    else expression=`${provider('spectrum',node.kind)}(${a}, selectionLength)`;break;
   case 'component':expression=`${a}.${node.component===0?'x':'y'}`;break;
   case 'linear': {
    helpers.set('linear',fn(vector,'recipeLinear',[[scalar,'position'],[vector,'grid']],`${declaration(scalar,'index','min(grid.x * grid.y - 1.0, floor(clamp(position, 0.0, 1.0) * grid.x * grid.y))')}\nreturn ${vector}(index - floor(index / grid.x) * grid.x + 0.5, floor(index / grid.x) + 0.5) / grid;`));
    expression=`recipeLinear(${a}, grid)`;break;
   }
   case 'hilbert': {
    const variable = (type,name,value) => wgsl ? `var ${name}: ${type} = ${value};` : `${type} ${name} = ${value};`;
    const swap=wgsl?'let swap = x; x = y; y = swap;':'int swap = x; x = y; y = swap;';
    helpers.set('hilbert',fn(vector,'recipeHilbert',[[scalar,'position'],[integer,'side']],`${variable(integer,'t',`min(side * side - 1, ${integer}(floor(clamp(position, 0.0, 1.0) * ${scalar}(side * side))))`)}\n${variable(integer,'x','0')}\n${variable(integer,'y','0')}\nfor (${variable(integer,'scale','1')} scale < side; scale *= 2) {\n${declaration(integer,'rx','(t / 2) & 1')}\n${declaration(integer,'ry','(t ^ rx) & 1')}\nif (ry == 0) { if (rx == 1) { x = scale - 1 - x; y = scale - 1 - y; } ${swap} }\nx += scale * rx; y += scale * ry; t /= 4;\n}\nreturn (${vector}(${scalar}(x), ${scalar}(y)) + ${vector}(0.5)) / ${scalar}(side);`));
    const side=node.order?String(2**node.order):`${integer}(exp2(min(15.0, ceil(log2(sqrt(max(1.0, selectionLength)))))))`;
    expression=`recipeHilbert(${a}, ${side})`;break;
   }
   default:throw new TypeError('Unsupported shader operation');
  }
  statements.push(declaration(node.type==='vec2'?vector:scalar,`r${node.id}`,expression));
 }
 const outputs=Object.keys(program.outputs), fields=outputs.length?outputs:['unused'];
 const struct=wgsl?`struct RecipeResult { ${fields.map(name=>`${name}: f32,`).join(' ')} }`:`struct RecipeResult { ${fields.map(name=>`float ${name};`).join(' ')} };`;
 if(wgsl)statements.push(`return RecipeResult(${outputs.length?outputs.map(name=>unit(`r${program.outputs[name]}`)).join(', '):'0.0'});`);
 else {statements.push('RecipeResult result;');for(const name of fields)statements.push(`result.${name} = ${outputs.length?unit(`r${program.outputs[name]}`):'0.0'};`);statements.push('return result;');}
 const args=wgsl?[[`array<f32, ${factorCount}>`,'sourceFactors'],[scalar,'pointOffset'],[scalar,'selectionLength'],[vector,'grid']]:[[`float`,`sourceFactors[${factorCount}]`],[scalar,'pointOffset'],[scalar,'selectionLength'],[vector,'grid']];
 const prototypes=wgsl?'':Array.from(external.values(),binding=>`float ${binding.name}(int index);`).join('\n');
 return {language,bindings:[...external.values()],source:[struct,prototypes,...helpers.values(),fn('RecipeResult','evaluateRecipes',args,statements.join('\n'))].filter(Boolean).join('\n\n')};
}
/**
 * Use the canonical slot ABI instead of duplicating numeric source indices in shader generation.
 */
function programFactorIndex(name){return indices[name];}
