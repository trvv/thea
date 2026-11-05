import assert from 'node:assert/strict';
import { pointFactors } from '../point-factors.js';
import { pointGrid, gridCoordinates, positionMappings } from '../arrangements.js';
import { presetConfiguration, validateConfiguration } from '../point-configuration.js';
import { defaultAppearance } from '../appearance.js';
import { factorIndices as slots, factorCount } from '../factor-catalog.js';
import { requiredFactors } from '../factors.js';
import { entropyShading, hilbertCells, byteCharacter, executeRender } from '../rendering.js';
import { validateProfile, serializeProfile, parseProfile } from '../profiles.js';
import { RenderCanvas } from './render-canvas.js';

let reads=0;
class Source extends Blob{slice(...args){reads++;return super.slice(...args);}}
const source=new Source([Uint8Array.from({length:1024},(_,i)=>(i*71+(i>>>2))%251)]);
const configuration={...presetConfiguration('linear'),layout:'linear3d',space:'cube',grid:{columns:4,rows:3}};
const base={kind:'view',source,offset:0,length:27,region:'linear',columns:96,rows:72,width:96,height:72,scale:1,pointScale:1,
 sampleLayout:{columns:8,rows:4},shaders:[],configuration};
const plain={...defaultAppearance('linear'),hue:'none',lightness:'none'},helpers={entropyShading,hilbertCells,byteCharacter};
async function collect(job,appearance=plain,cache={}){
 const visit=await pointFactors(job,appearance,cache,()=>true,helpers),points=[];
 visit((values,label,context)=>points.push({values:[...values],index:context.pointIndex,count:context.pointCount,offset:context.offset}));
 return {points,grid:visit.grid};
}
const {points,grid}=await collect(base);
assert.equal(points.length,27);assert.deepEqual(grid,{columns:4,rows:3,slices:3});
for(let index=0;index<27;index++){
 assert.equal(points[index].values[slots.column],(index%4+0.5)/4);
 assert.equal(points[index].values[slots.row],(Math.floor(index/4)%3+0.5)/3);
 assert.equal(points[index].values[slots.slice],(Math.floor(index/12)+0.5)/3);
}
assert.equal(reads,0,'Coordinate-only cube read source bytes');
assert.deepEqual(positionMappings(configuration),['column','row','slice']);
const manual={...configuration,layout:'mapped',position:['phase','entropy','amplitude']};
assert.deepEqual(positionMappings(manual),manual.position);
assert(!requiredFactors({...manual,layout:'linear3d'},plain).has('phase'),'Hidden manual mappings requested an FFT');

// Explicit strides are in population units; sample limits keep coordinates and
// provider values of surviving points, rather than renumbering or reflowing them.
const limited=await collect({...base,configuration:{...configuration,sampleLimit:5}});
assert.deepEqual(limited.grid,grid);
for(const point of limited.points)assert.deepEqual(point.values,points[point.index].values);
assert.equal(base.length,27);
for(const population of ['bytes','pairs','triples','bins']){
 const job={...base,length:64,sampleLayout:{columns:8,rows:8},configuration:{...configuration,population}};
 const result=await collect(job);
 for(const point of result.points){
  const expected=new Float64Array(3);gridCoordinates(point.index,result.grid,'linear3d',expected);
  assert.deepEqual([point.values[slots.column],point.values[slots.row],point.values[slots.slice]],[...expected]);
 }
}

// A third coordinate is usable independently in mapped position or appearance.
const sliceOnly={...base,configuration:{...configuration,layout:'mapped',position:['none','none','none']}};
const sliced=await collect(sliceOnly,{...plain,lightness:'slice'});
assert(sliced.points[0].values[slots.slice]<sliced.points.at(-1).values[slots.slice]);
assert.equal(slots.slice,15);assert.equal(factorCount,16,'Existing factor slots must not be reordered');

for(const layout of ['linear','linear3d','hilbert','hilbert3d']){
 const cfg={...configuration,layout,grid:{columns:0,rows:0}};
 const shape=pointGrid(cfg,64,{columns:8,rows:8});
 const seen=new Set();let previous;
 for(let index=0;index<64;index++){
  const out=new Float64Array(3);gridCoordinates(index,shape,layout,out);
  assert(out.every(value=>value>0&&value<1));
  const cell=[out[0]*shape.columns-0.5,out[1]*shape.rows-0.5,out[2]*shape.slices-0.5];
  assert(!seen.has(cell.join('/')));seen.add(cell.join('/'));
  if(previous&&layout.startsWith('hilbert'))assert.equal(cell.reduce((sum,value,axis)=>sum+Math.abs(value-previous[axis]),0),1);
  previous=cell;
 }
}

// All arrangements change Trigraph placement while preserving the tuple set,
// selected interval, and stored mapped axes. Camera and DPR do not rebuild it.
const tri={...base,length:64,sampleLayout:{columns:8,rows:8},configuration:presetConfiguration('trigraph'),region:'trigraph',appearance:plain};
const canvas=new RenderCanvas(),cache={};await executeRender(canvas,tri,cache);
const mapped=cache.preparedPoints.positions.slice(),count=cache.preparedPoints.size;
for(const layout of ['linear','linear3d','hilbert','hilbert3d']){
 const job={...tri,configuration:{...tri.configuration,layout}};
 await executeRender(canvas,job,cache);
 assert.equal(cache.preparedPoints.size,count);assert.notDeepEqual(cache.preparedPoints.positions,mapped,`${layout} did not arrange tuples`);
 const prepared=cache.preparedPoints;
 await executeRender(canvas,{...job,rotation:{yaw:0.9,pitch:0.1},pointScale:2,columns:192,rows:144},cache);
 assert.equal(cache.preparedPoints,prepared);
}
await executeRender(canvas,tri,cache);assert.deepEqual(cache.preparedPoints.positions,mapped,'Mapped coordinates were lost');

// Grid footprint now uses perspective cell size in 3D rather than ignoring the option.
const sparse={...base,appearance:plain,length:8,configuration:{...configuration,grid:{columns:2,rows:2},footprint:'point'}};
await executeRender(canvas,sparse,cache);const small=canvas.pixels.filter((value,index)=>index%4!==3&&value>0).length;
await executeRender(canvas,{...sparse,configuration:{...sparse.configuration,footprint:'grid'}},cache);
assert(canvas.pixels.filter((value,index)=>index%4!==3&&value>0).length>small);
for(const grid of [{columns:-1,rows:2},{columns:1.5,rows:2},{columns:1,rows:NaN},[],{columns:1,rows:65537}])assert.throws(()=>validateConfiguration({...configuration,grid}));

const profile={version:2,region:'linear',recipes:{},configuration,shaders:[],coordinateSystem:'cartesian',axes:[0,1],rotation:{yaw:0,pitch:0},encoding:'ascii',blankSpaces:false,blankNulls:true,frequencyOpacity:false};
assert.deepEqual(parseProfile(serializeProfile(profile)).configuration.grid,configuration.grid);
const oldConfiguration={...configuration,layout:'linear',position:['value','byte2','byte3']};
delete oldConfiguration.grid;delete oldConfiguration.sampling;
const legacy=validateProfile({...profile,version:1,configuration:oldConfiguration});
assert.equal(legacy.version,2);assert.equal(legacy.configuration.layout,'mapped');
assert.deepEqual(legacy.configuration.position,['value','byte2','byte3']);
assert.deepEqual(legacy.configuration.grid,{columns:0,rows:0});
const legacyHilbert=validateProfile({...profile,version:1,configuration:{...oldConfiguration,layout:'hilbert',position:['column','row','none']}});
assert.equal(legacyHilbert.configuration.layout,'hilbert');assert.equal(legacyHilbert.configuration.sampling,'representative');
console.log('Arrangement checks pass: strides/slices, all populations, layout placement, exact sampling, provider laziness, mapped restoration, 3D footprints, profile migration.');
