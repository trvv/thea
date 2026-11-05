import assert from 'node:assert/strict';
import { remapImage, spatialTransform, coordinateDimensions, sourceDimensions } from '../coordinates.js';
import { trigraphCounts, trigraphImage, cubeProjection } from '../trigraph.js';
import { executeRender } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';
const source=new Uint8ClampedArray(256*256*4);
for(let y=0;y<256;y++)for(let x=0;x<256;x++)source.set([x,y,123,255],(y*256+x)*4);
assert.deepEqual(remapImage(source,256,256,256,256),source);
const transposed=remapImage(source,256,256,256,256,'cartesian',[1,0]);
assert.deepEqual([...transposed.subarray((91*256+17)*4,(91*256+17)*4+4)],[91,17,123,255]);
const radial=remapImage(source,256,256,101,101,'radial');
const color=(image,x,y)=>[...image.subarray((y*101+x)*4,(y*101+x)*4+4)];
assert.deepEqual(color(radial,50,50),[0,0,123,255]);
assert.deepEqual(color(radial,0,0),[0,0,0,255]);
assert.equal(color(radial,50,0)[1],64);
assert.equal(color(radial,0,50)[1],128);
assert.equal(color(radial,50,100)[1],192);
const swapped=remapImage(source,256,256,101,101,'radial',[1,0]);
assert.equal(color(swapped,50,0)[0],64);
assert(color(swapped,50,0)[1]>250);
const spectral=remapImage(source,256,256,101,101,'radial',[1,0],{phase:true,flipY:true});
assert.deepEqual(color(spectral,50,50),[128,255,123,255],'Zero frequency must map to the center');
assert.equal(color(spectral,100,50)[0],128,'Zero phase must point right');
assert(color(spectral,100,50)[1]<4,'High frequency must be on the outer radius');

const pack=(a,b,c)=>a*65536+b*256+c;
const close=(a,b)=>{for(let i=0;i<3;i++)assert(Math.abs(a[i]-b[i])<1e-10,`${a} != ${b}`);};
const value=new Float64Array(3);
spatialTransform('cartesian',[2,0,1])(pack(255,0,128),value);close(value,[128/127.5-1,1,-1]);
spatialTransform('cylindrical')(pack(255,0,255),value);close(value,[1,1,0]);
spatialTransform('cylindrical')(pack(255,64,0),value);close(value,[0,-1,1]);
spatialTransform('cylindrical')(pack(0,101,128),value);close(value,[0,128/127.5-1,0]);
spatialTransform('spherical')(pack(255,0,0),value);close(value,[0,1,0]);
spatialTransform('spherical')(pack(255,0,255),value);close(value,[0,-1,0]);
spatialTransform('spherical')(pack(0,200,100),value);close(value,[0,0,0]);
assert.deepEqual(coordinateDimensions('trigraph','cylindrical'),['Radius','Angle','Height']);
assert.deepEqual(coordinateDimensions('trigraph','spherical'),['Radius','Azimuth','Inclination']);
assert.deepEqual(sourceDimensions('dft'),['Phase','Frequency']);

const counts=new Map([[pack(10,30,220),3],[pack(130,240,80),1],[pack(255,0,128),5]]);
const permuted=new Map([...counts].map(([key,count])=>[pack(key&255,(key>>>8)&255,key>>>16),count]));
assert.deepEqual(trigraphImage(counts,129,101,undefined,{},undefined,{axes:[2,1,0]}),trigraphImage(permuted,129,101));
const blob=new Blob([Uint8Array.from({length:400},(_,i)=>(i*i+13*i)%256)]),cache={},scratch={};
const histogram=await trigraphCounts({source:blob,offset:0,length:400},cache);
for(const coordinateSystem of ['cartesian','cylindrical','spherical'])for(const axes of [[0,1,2],[2,0,1]])for(const frequencyOpacity of [false,true]){
 const options={coordinateSystem,axes,frequencyOpacity};
 const actual=trigraphImage(histogram.counts,129,101,undefined,scratch,histogram,options).slice();
 const expected=trigraphImage(histogram.counts,129,101,undefined,{},undefined,options);
 assert.deepEqual(actual,expected,'Coordinate change did not invalidate cached geometry');
 const project=cubeProjection(129,101,undefined,options);
 for(const bytes of [[0,0,0],[255,255,255],[255,128,64]]){
  const point=project(...bytes);assert(point.x>=0&&point.x<129&&point.y>=0&&point.y<101);
 }
}
const canvas=new RenderCanvas();
await executeRender(canvas,{kind:'view',region:'digraph',source:blob,offset:0,length:400,columns:256,rows:256,width:101,height:81,scale:1,coordinateSystem:'radial',axes:[1,0],shaders:[]});
assert.equal(canvas.width,101);assert.equal(canvas.height,81);assert.equal(canvas.pixels.length,101*81*4);
console.log('Coordinate checks pass: Cartesian identity/swap, radial axes and boundaries, DFT phase/frequency semantics, cylindrical/spherical transforms, axis permutations, cached rendering, worker-compatible remapping.');
