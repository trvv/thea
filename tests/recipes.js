import assert from 'node:assert/strict';
import { compileRecipes, constant, reference, hilbertCoordinate, validateRecipe } from '../recipes.js';
import { emitRecipeShader } from '../recipe-shaders.js';
import { recipeMenu } from '../recipe-menu.js';
import { pointFactors, windowEntropy } from '../point-factors.js';
import { presetConfiguration } from '../point-configuration.js';
import { defaultAppearance } from '../appearance.js';
import { factorCount, factorIndices as slots, requiredFactors } from '../factors.js';
import { entropyShading, hilbertCells, byteCharacter, executeRender, renderCost } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';
const next={op:'normalize',min:0,max:255,input:{op:'byte',offset:{op:'add',a:{op:'offset'},b:constant(1)}}};
const roots={p0:hilbertCoordinate(0,'position',3),p1:hilbertCoordinate(1,'position',3),hue:reference('next'),opacity:{op:'invert',input:reference('next')}};
const program=compileRecipes(roots,{next});
assert.equal(program.nodes.filter(node=>node.op==='hilbert').length,1,'Hilbert vector was duplicated');
assert.equal(program.nodes.filter(node=>node.op==='byte').length,1,'Shared byte expression was duplicated');
assert.equal(program.required.size,1);assert(program.providers.byte);
assert.equal(compileRecipes(structuredClone(roots),{next}),program,'Equivalent expressions were recompiled');
const evaluate=program.createEvaluator(),factors=new Float64Array(program.factorCount),cells=hilbertCells(8);
const context={offset:0,length:64,grid:[8,8],byte:index=>index>=0&&index<64?index:0};
for(let i=0;i<64;i++){
 context.offset=i;factors[slots.position]=i/64;evaluate(factors,context);
 assert.equal(factors[program.bindings.p0],(cells[i]%8+0.5)/8);
 assert.equal(factors[program.bindings.p1],(Math.floor(cells[i]/8)+0.5)/8);
 assert(Math.abs(factors[program.bindings.hue]-(i===63?0:(i+1)/255))<1e-7);
 assert(Math.abs(factors[program.bindings.opacity]-(1-factors[program.bindings.hue]))<1e-7);
}
assert.throws(()=>validateRecipe({op:'component',input:'value',component:0}));
assert.throws(()=>validateRecipe({op:'hilbert',input:'position',order:3}),'A vector was accepted as a scalar display channel');
assert.throws(()=>compileRecipes({x:reference('a')},{a:reference('b'),b:reference('a')}));
assert.throws(()=>validateRecipe({op:'normalize',input:'value',min:1,max:0}));
assert.throws(()=>validateRecipe({op:'constant',value:Infinity}));
assert.throws(()=>validateRecipe({op:'arbitraryJavaScript',code:'globalThis.x=1'}));
const cycle={op:'invert'};cycle.input=cycle;assert.throws(()=>validateRecipe(cycle));
let deep='value';for(let i=0;i<40;i++)deep={op:'invert',input:deep};assert.throws(()=>validateRecipe(deep));
const math=compileRecipes({x:{op:'divide',a:constant(3),b:constant(0)},y:{op:'power',input:constant(0),exponent:0},z:{op:'fract',input:constant(-0.25)}});
const calculated=new Float64Array(math.factorCount);math.createEvaluator()(calculated,context);
assert.equal(calculated[math.bindings.x],0);assert.equal(calculated[math.bindings.y],1);assert.equal(calculated[math.bindings.z],0.75);
const signal=Uint8Array.from({length:160},(_,i)=>(i*29+(i>>>2))%256);
for(const size of [1,2,7,32,64,256]){
 const actual=windowEntropy(signal,size);
 for(let i=0;i<signal.length;i++){
  const start=Math.max(0,i-Math.floor(size/2)),end=Math.min(signal.length,i+size-Math.floor(size/2));
  const counts=new Uint32Array(256);for(let j=start;j<end;j++)counts[signal[j]]++;
  let expected=0;for(const count of counts)if(count){const p=count/(end-start);expected-=p*Math.log2(p);}
  expected=size===1?0:Math.min(1,expected/Math.min(8,Math.log2(size)));
  assert(Math.abs(actual[i]-expected)<1e-6,`Entropy mismatch: ${size}/${i}`);
 }
}
let reads=0;class Source extends Blob{slice(...args){reads++;return super.slice(...args);}}
const source=new Source([signal]);
const job={kind:'view',source,offset:16,length:64,columns:64,rows:48,width:64,height:48,scale:1,region:'linear',
 configuration:{...presetConfiguration('linear'),recipes:{next}},sampleLayout:{columns:8,rows:8},shaders:[]};
const appearance={...defaultAppearance('linear'),hue:'none',lightness:'none'};
const noReads={...job,configuration:{...job.configuration,position:[hilbertCoordinate(0),hilbertCoordinate(1),'none']}};
await executeRender(new RenderCanvas(),{...noReads,appearance});assert.equal(reads,0,'Coordinate recipe read the source');
const mixed={...job,appearance:{...appearance,hue:{op:'entropy',offset:{op:'offset'},window:64},lightness:reference('next')},
 configuration:{...job.configuration,position:[hilbertCoordinate(0),hilbertCoordinate(1),'none']}};
const cache={};
const visit=await pointFactors(mixed,mixed.appearance,cache,()=>true);
assert(cache.recipeEntropy.values.has(64));assert(!cache.factorEntropy&&!cache.factorSpectrum&&!cache.factorCounts,'Recipe requested unrelated providers');
const outputs=[];const compiled=compileRecipes({x:mixed.appearance.hue,y:reference('next')},{next});const run=compiled.createEvaluator();
visit((factors,label,context)=>{const input=new Float64Array(Math.max(factors.length,compiled.factorCount));input.set(factors);run(input,context);outputs.push(input[compiled.bindings.x]);});
const expected=windowEntropy(signal,64);for(let i=0;i<64;i++)assert(Math.abs(outputs[i]-expected[i+16])<1e-6);
const windowBefore=cache.factorWindow;
await pointFactors({...mixed,rotation:{yaw:1}},mixed.appearance,cache,()=>true);assert.equal(cache.factorWindow,windowBefore);
const spectrumRecipe={op:'spectrum',kind:'phase',input:{op:'invert',input:'position'}};
assert(requiredFactors(job.configuration,{...appearance,hue:spectrumRecipe}).has('phase'));
assert(renderCost({...job,appearance:{...appearance,hue:spectrumRecipe}})>renderCost({...job,appearance}));
let edited, saved;
const menu=recipeMenu('Hue','position',{},value=>edited=value,value=>saved=value);
menu.items.find(item=>item.label==='Transform').items.find(item=>item.label==='Hilbert X').action();
assert.equal(edited.op,'component');assert.equal(edited.input.op,'hilbert');
const second=recipeMenu('Hue',edited,{},value=>edited=value,value=>saved=value);
second.items.find(item=>item.label==='Order').action(4);assert.equal(edited.input.order,4);
second.items.find(item=>item.label==='Save Factor').action();assert(saved);
const arithmetic=recipeMenu('Size',{op:'add',a:'value',b:constant(2)},{},value=>edited=value);
arithmetic.items.find(item=>item.label==='Operand').items.find(item=>item.label==='Value').action(0.25);assert.equal(edited.b.value,0.25);
for(const language of ['glsl','wgsl']){
 const shader=emitRecipeShader(program,language);
 assert(shader.source.includes('evaluateRecipes'));assert.equal(shader.bindings.filter(binding=>binding.kind==='byte').length,1);
 assert.equal((shader.source.match(/= recipeHilbert\(/g)||[]).length,1,'Shared vector was emitted twice');
 assert(!shader.source.includes('undefined'));assert(!shader.source.includes('eval('));
}
for(const space of ['square','circle','cube','cylinder','sphere']){
 const spec=structuredClone({...mixed,source:undefined});spec.source=source;spec.configuration.space=space;
 const first=new RenderCanvas(),second=new RenderCanvas();await executeRender(first,spec);await executeRender(second,structuredClone(spec));
 assert.deepEqual(first.snapshot(),second.snapshot(),'Serialized recipes changed rendering');
}
console.log('Recipe checks pass: typed DAG, shared expressions, arithmetic, Hilbert coordinates, named factors, validation/cycles, lazy providers, configurable entropy, editing, serialization, GLSL/WGSL emission.');

// Direct source/constant lowering retains the interpreter's float32 and finite-output contract.
const primitive=compileRecipes({x:'value',y:constant(2),z:constant(-1)});
const interpreted=compileRecipes({x:{op:'add',a:'value',b:constant(0)}});
const direct=primitive.createEvaluator(),generic=interpreted.createEvaluator();
for(const input of [NaN,Infinity,-Infinity,-0.5,0,0.123456789,0.5,1,1.5]) {
 const a=new Float64Array(primitive.factorCount),b=new Float64Array(interpreted.factorCount);a[0]=b[0]=input;
 direct(a,{});generic(b,{});
 assert.equal(a[primitive.bindings.x],b[interpreted.bindings.x]);
 assert.equal(a[primitive.bindings.y],1);assert.equal(a[primitive.bindings.z],0);
}
