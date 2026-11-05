import assert from 'node:assert/strict';
import { hilbert3D } from '../hilbert.js';
import { compileRecipes, constant, hilbertCoordinate, hilbert3DCoordinate, recipeLabel, validateRecipe } from '../recipes.js';
import { recipeMenu } from '../recipe-menu.js';
import { pointFactors } from '../point-factors.js';
import { presetConfiguration } from '../point-configuration.js';
import { defaultAppearance } from '../appearance.js';
import { entropyShading, hilbertCells, byteCharacter, executeRender } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';

// Lock the Skilling orientation at order 1 independently of CPU/shader parity.
const firstCube=[[0,0,0],[0,0,1],[0,1,1],[0,1,0],[1,1,0],[1,1,1],[1,0,1],[1,0,0]];
const xyz=new Float64Array(3);
for(let i=0;i<8;i++)assert.deepEqual([...hilbert3D(i,1,xyz)].map(v=>Math.floor(v*2)),firstCube[i]);
for(let order=0;order<=4;order++){
 const side=2**order,seen=new Set();let previous;
 for(let index=0;index<side**3;index++){
  hilbert3D(index,order,xyz);
  const cell=[...xyz].map(value=>value*side-0.5);
  assert(cell.every(value=>Number.isInteger(value)&&value>=0&&value<side));
  const key=cell.join('/');assert(!seen.has(key),'Hilbert curve revisited a cell');seen.add(key);
  if(previous)assert.equal(cell.reduce((sum,value,axis)=>sum+Math.abs(value-previous[axis]),0),1,'Consecutive cells are not face-adjacent');
  previous=cell;
 }
 assert.equal(seen.size,side**3);
}
assert.throws(()=>hilbert3D(0,11,xyz));assert.throws(()=>hilbert3D(8,1,xyz));

const roots=Object.fromEntries(['x','y','z'].map((name,axis)=>[name,hilbert3DCoordinate(axis)]));
const program=compileRecipes({...roots,oldX:hilbertCoordinate(0),oldY:hilbertCoordinate(1)});
assert.equal(program.nodes.filter(node=>node.op==='hilbert3d').length,1,'XYZ duplicated their shared curve');
const run=program.createEvaluator(),factors=new Float64Array(program.factorCount),context={pointIndex:0,pointCount:64,offset:0,length:64,grid:[8,8]};
for(let i=0;i<64;i++){
 context.pointIndex=i;run(factors,context);hilbert3D(i,2,xyz);
 for(const [axis,name] of ['x','y','z'].entries())assert.equal(factors[program.bindings[name]],xyz[axis]);
}
assert.equal(recipeLabel(roots.z),'Hilbert3D(Point Index).Z');
assert.throws(()=>validateRecipe({op:'hilbert3d',input:'position'}),'Vector accepted as a scalar channel');
assert.throws(()=>validateRecipe({op:'component',input:{op:'hilbert',input:'position'},component:2}));
assert.throws(()=>validateRecipe(hilbert3DCoordinate(3)));
assert.throws(()=>validateRecipe(hilbert3DCoordinate(0,'position',11)));
assert.throws(()=>validateRecipe(hilbert3DCoordinate(0,'position',1.5)));

// Exact integer inputs remain distinct past float32's adjacent-integer limit.
const exact=compileRecipes(Object.fromEntries(['x','y','z'].map((name,axis)=>[name,hilbert3DCoordinate(axis,{op:'pointIndex'},10)])));
const exactRun=exact.createEvaluator(),exactFactors=new Float64Array(exact.factorCount);
let previous;
for(let index=2**24-2;index<2**24+4;index++){
 exactRun(exactFactors,{pointIndex:index,pointCount:2**30,length:0});
 const cell=['x','y','z'].map(name=>exactFactors[exact.bindings[name]]*1024-0.5);
 if(previous)assert.equal(cell.reduce((sum,value,axis)=>sum+Math.abs(value-previous[axis]),0),1);
 previous=cell;
}

// Scalar input 1 reaches the final cell; a one-point automatic curve is centered.
const endpoint=compileRecipes({x:hilbert3DCoordinate(0,constant(1),1)}),endFactors=new Float64Array(endpoint.factorCount);
endpoint.createEvaluator()(endFactors,{length:8,pointCount:8});assert.equal(endFactors[endpoint.bindings.x],0.75);
run(factors,{...context,pointCount:1,pointIndex:0});for(const name of ['x','y','z'])assert.equal(factors[program.bindings[name]],0.5);

// Nonfinite visual intermediates still reach the established finite-output guard.
const overflow={op:'power',input:constant(1000000),exponent:16};
const invalidInput={op:'subtract',a:overflow,b:overflow};
const nonfinite=compileRecipes({x:hilbert3DCoordinate(0,invalidInput,1)}),nonfiniteFactors=new Float64Array(nonfinite.factorCount);
nonfinite.createEvaluator()(nonfiniteFactors,{length:8,pointCount:8});assert.equal(nonfiniteFactors[nonfinite.bindings.x],0);

// The Source list has one canonical entry per primitive. Configurable lookups
// stay available as transformations; named factors cannot duplicate built-in rows.
let edited;
const menu=recipeMenu('Factor',{op:'factor',name:'phase'},{'Local Entropy':'value'},value=>edited=value);
const sources=menu.items.find(item=>item.label==='Source').items;
assert.equal(new Set(sources.map(item=>item.label)).size,sources.length,'Duplicate Source labels');
for(const label of ['Local Entropy','DFT Phase','DFT Frequency','DFT Amplitude'])assert.equal(sources.filter(item=>item.label===label).length,1);
assert(sources.find(item=>item.label==='DFT Phase').checked);
assert(!sources.some(item=>item.label==='Read Byte'||item.label.startsWith('Hilbert')));
const transform=menu.items.find(item=>item.label==='Transform').items;
for(const label of ['Read Byte','Local Entropy','DFT Phase'])assert(transform.some(item=>item.label===label));
transform.find(item=>item.label==='Hilbert 3D').items.find(item=>item.label==='Z').action();
assert.equal(edited.input.op,'hilbert3d');assert.equal(edited.component,2);
const editor=recipeMenu('Factor',hilbert3DCoordinate(2),{},value=>edited=value);
const component=editor.items.find(item=>item.label==='Component');assert.deepEqual(component.options.map(item=>item.label),['X','Y','Z']);
editor.items.find(item=>item.label==='Order').action(4);assert.equal(edited.input.order,4);

// Coordinate-only 3D traversals are lazy and apply to all populations. Frequency
// bin ordinals are independent of the compatibility bin -> byte correspondence.
let reads=0;class Source extends Blob{slice(...args){reads++;return super.slice(...args);}}
const source=new Source([Uint8Array.from({length:512},(_,i)=>i%7)]);
const base={kind:'view',source,offset:0,length:64,region:'linear',shaders:[],columns:64,rows:48,width:64,height:48,scale:1,pointScale:1,
 sampleLayout:{columns:8,rows:8},configuration:{...presetConfiguration('linear'),space:'cube',footprint:'point',layout:'mapped',position:Object.values(roots)}};
const appearance={...defaultAppearance('linear'),hue:'none',lightness:'none'},helpers={entropyShading,hilbertCells,byteCharacter};
for(const population of ['bytes','bins','pairs','triples']){
 const job={...base,configuration:{...base.configuration,population}};
 const visit=await pointFactors(job,appearance,{},()=>true,helpers),points=[];
 visit((values,label,ctx)=>points.push({index:ctx.pointIndex,count:ctx.pointCount,offset:ctx.offset}));
 const expectedCount=population==='bytes'?64:population==='bins'?33:7;
 assert.equal(points.length,expectedCount);
 for(let i=0;i<points.length;i++){assert.equal(points[i].index,i);assert.equal(points[i].count,expectedCount);}
 if(population==='bins')assert.equal(points.at(-1).index,32);
 const canvas=new RenderCanvas(),cache={};await executeRender(canvas,{...job,appearance},cache);
 const prepared=cache.preparedPoints;assert(prepared.positions.some(v=>v!==0));
 await executeRender(canvas,{...job,appearance,rotation:{yaw:1,pitch:0.1}},cache);assert.equal(cache.preparedPoints,prepared);
}
assert(reads>0,'Tuple populations must inspect bytes');
reads=0;await executeRender(new RenderCanvas(),{...base,appearance});assert.equal(reads,0,'Coordinate-only Hilbert read source bytes');
const sampled={...base,configuration:{...base.configuration,sampleLimit:8}};
const indices=[];(await pointFactors(sampled,appearance,{},()=>true,helpers))((values,label,ctx)=>indices.push(ctx.pointIndex));
assert.deepEqual(indices,[0,8,16,24,32,40,48,56],'Sample limit renumbered exact byte indices');
console.log('Hilbert checks pass: cube orientation, exhaustive adjacency/uniqueness, exact indices, shared vec3, validation, menus, populations, laziness, camera reuse.');
