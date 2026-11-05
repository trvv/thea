import assert from 'node:assert/strict';
import { compilePosition, presetConfiguration, resolveViewJob } from '../point-configuration.js';
import { executeRender } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';
const value=new Float64Array(3),out=new Float64Array(3);
const close=(expected)=>expected.forEach((v,i)=>assert(Math.abs(v-out[i])<1e-10,`${out} != ${expected}`));
const transform=space=>compilePosition({...presetConfiguration('trigraph'),space,position:[0,1,2]});
value.set([1,0,1]);transform('cylinder')(value,out);close([1,1,0]);
value.set([1,0.25,0]);transform('cylinder')(value,out);close([0,-1,1]);
value.set([0,0.3,0.5]);transform('cylinder')(value,out);close([0,0,0]);
value.set([1,0,0]);transform('sphere')(value,out);close([0,1,0]);
value.set([1,0,1]);transform('sphere')(value,out);close([0,-1,0]);
value.set([0,0.8,0.4]);transform('sphere')(value,out);close([0,0,0]);
value.set([1,0.25,0]);transform('circle')(value,out);close([0,-1,0]);
const source=new Blob([Uint8Array.from({length:400},(_,i)=>(i*i+13*i)%256)]);
for(const region of ['linear','hilbert','hilbert3d','digraph','dft','trigraph']) {
 const spatial=['trigraph','hilbert3d'].includes(region),axes=spatial?[2,0,1]:[1,0];
 for(const coordinateSystem of spatial?['cartesian','cylindrical','spherical']:['cartesian','radial']) {
  const job={kind:'view',source,offset:0,length:400,region,coordinateSystem,axes,shaders:[],columns:101,rows:81};
  const configuration=presetConfiguration(region,{coordinateSystem,axes});
  const a=new RenderCanvas(),b=new RenderCanvas();
  await executeRender(a,job);await executeRender(b,{...job,configuration});
  assert.deepEqual(a.pixels,b.pixels,'Compatibility coordinate input diverged from explicit configuration');
  const resolved=resolveViewJob(job);assert.deepEqual(resolved.configuration,configuration);
 }
}
const swapped=presetConfiguration('dft',{coordinateSystem:'radial',axes:[1,0]});
assert.equal(swapped.space,'circle');assert.deepEqual(swapped.position,['frequency','phase','none']);
assert.deepEqual(swapped.inverted,[true,false,false],'Axis swaps must move direction flags with their channels');
console.log('Coordinate checks pass: normalized transforms, axis permutations, DFT directions, all preset migrations, one render pipeline.');

assert.deepEqual(presetConfiguration('linear',{axes:[0,1]}).position,['column','row','slice'],'Identity compatibility axes discarded hidden Slice mapping');
assert.deepEqual(presetConfiguration('linear',{axes:[1,0]}).position,['row','column','slice'],'Axis swap discarded hidden Slice mapping');
