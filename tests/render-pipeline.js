import assert from 'node:assert/strict';
import { executeRender } from '../rendering.js';
import { presetConfiguration } from '../point-configuration.js';
import { defaultAppearance } from '../appearance.js';
import { RenderEngine } from '../render-engine.js';
import { RenderCanvas } from './render-canvas.js';
let reads=0;class Source extends Blob{slice(...args){reads++;return super.slice(...args);}}
const source=new Source([Uint8Array.from({length:1024},(_,i)=>(i*i+37*i)%251)]);
const base={kind:'view',source,offset:0,length:256,columns:96,rows:64,shaders:['entropy','brightness']};
for(const region of ['linear','hilbert','hilbert3d','digraph','dft','trigraph'])for(const shaders of [[],['brightness'],['entropy','brightness'],['hex']]) {
 const cache={},canvas=new RenderCanvas(),explicit=new RenderCanvas(),job={...base,region,shaders};
 await executeRender(canvas,job,cache);
 assert(cache.preparedPoints&&cache.pointGeometry&&cache.pointRaster,'Preset bypassed a shared stage');
 await executeRender(explicit,{...job,configuration:presetConfiguration(region),sampleLayout:{columns:96,rows:64},appearance:defaultAppearance(region,shaders)});
 assert.deepEqual(canvas.snapshot(),explicit.snapshot(),`${region}/${shaders}: preset differs from its configuration`);
}
for(const space of ['square','circle','cube','sphere','cylinder']) {
 const canvas=new RenderCanvas(),fresh=new RenderCanvas(),cache={};
 const configuration={...presetConfiguration('linear'),space,footprint:'point',position:['value','byte2','byte3']};
 let job={...base,region:'linear',configuration,sampleLayout:{columns:32,rows:8},appearance:defaultAppearance('linear')};
 await executeRender(canvas,job,cache);const positions=cache.preparedPoints.positions,projected=cache.pointRaster.projected;
 for(const appearance of [{...job.appearance,hue:'byte2'},{...job.appearance,size:'value',shape:'circle'},{...job.appearance,opacity:'pairCount'}]) {
  job={...job,appearance};const before=reads,metrics=await executeRender(canvas,job,cache);
  assert.equal(reads,before,'Appearance reread an already cached byte window');
  await executeRender(fresh,job);
  assert(metrics.reused.geometry&&metrics.reused.projection,'Appearance discarded geometry/projection');
  assert.equal(cache.preparedPoints.positions,positions);assert.equal(cache.pointRaster.projected,projected);
  assert.equal(metrics.timings.projection,0);assert.equal(metrics.timings.sorting,0);
  assert.deepEqual(canvas.pixels,fresh.pixels,'Stage reuse changed output');
 }
 // Calibration follows the actual configuration rather than its preset label.
 const engine=new RenderEngine(canvas),key=engine.key(job);
 assert.equal(engine.key({...job,region:'dft'}),key);
 const backend=await executeRender(canvas,{...job,configuration:{...configuration,backend:'webgl'}},cache);
 assert(backend.reused.geometry&&backend.reused.projection,'Backend change discarded shared preparation');
 const resized=await executeRender(canvas,{...job,columns:97},cache);
 assert(resized.reused.geometry&&!resized.reused.projection,'Raster resize should only invalidate projection');
 const moved=await executeRender(canvas,{...job,offset:1},cache);
 assert(!moved.reused.geometry&&!moved.reused.projection,'Source range failed to invalidate geometry');
}
// Truncation (including zero visible marks) must remain safe when only appearance changes.
for(const end of [1,64]) {
 const config={...presetConfiguration('linear'),position:['value','byte2','none'],dimensions:{width:{start:0,end,step:1,mode:'truncate',fit:true}}};
 const job={...base,region:'linear',configuration:config,sampleLayout:{columns:32,rows:8},offset:256,length:128};
 const canvas=new RenderCanvas(),fresh=new RenderCanvas(),cache={};await executeRender(canvas,job,cache);
 if(end===1)assert.equal(cache.preparedPoints.size,0,'Empty truncation fixture is not empty');
 const changed={...job,appearance:{...defaultAppearance('linear'),hue:'byte2'}};
 await executeRender(canvas,changed,cache);await executeRender(fresh,changed);
 assert.deepEqual(canvas.pixels,fresh.pixels,'Visible ordinal cache differs after truncation');
}
console.log('Unified pipeline checks pass: all presets/flags use identical stages; color, size, opacity, backend, resize and source invalidation; truncation.');

const implicit=new RenderCanvas(),explicit=new RenderCanvas();
await executeRender(implicit,{kind:'view',source,columns:32,rows:32});
await executeRender(explicit,{kind:'view',source,columns:32,rows:32,region:'linear',offset:0,length:source.size,shaders:['entropy','brightness']});
assert.deepEqual(implicit.pixels,explicit.pixels,'Optional legacy job defaults were not resolved');
