import assert from 'node:assert/strict';
import { compileAppearance, defaultAppearance } from '../appearance.js';
import { executeRender, cellColor } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';
import { RenderEngine } from '../render-engine.js';
const base={kind:'view',source:new Blob([Uint8Array.from({length:256},(_,i)=>i)]),offset:0,length:256,
 columns:16,rows:16,width:16,height:16,scale:1,shaders:['entropy','brightness'],region:'linear'};
const mapped=defaultAppearance('linear');
const compiled=compileAppearance('linear',mapped);
assert.equal(compiled,compileAppearance('linear',{...mapped}));
for(let value=0;value<256;value+=17)for(let entropy=0;entropy<256;entropy+=17){
 const rgba=new Uint8ClampedArray(4);compiled.rgba([value/255,entropy/255],rgba);
 assert.deepEqual([...rgba].slice(0,3),cellColor(value,entropy,base.shaders));
}
const original=new RenderCanvas(),custom=new RenderCanvas();
await executeRender(original,base);
await executeRender(custom,{...base,appearance:mapped});
assert.deepEqual(custom.pixels,original.pixels,'Explicit defaults must preserve grid colors');
const swapped={...mapped,hue:'value',lightness:'entropy'};
await executeRender(custom,{...base,shaders:[],appearance:swapped});
assert.notDeepEqual(custom.pixels,original.pixels,'Mapped entropy must be calculated without legacy shader flag');
const canvas=new RenderCanvas();
for(const region of ['linear','hilbert','digraph','dft','trigraph']){
 const appearance={...defaultAppearance(region),hue:region==='trigraph'||region==='digraph'?'byte1':region==='dft'?'phase':'position'};
 const job={...base,region,appearance,rotation:{yaw:-0.6,pitch:0.45}};
 const cache={};
 await executeRender(canvas,job,cache);
 const first=structuredClone(canvas.snapshot());
 await executeRender(canvas,job,cache);
 assert.deepEqual(canvas.snapshot(),first,`${region} cached rendering differs`);
 const sized={...appearance,size:appearance.hue,shape:'circle',opacity:appearance.lightness};
 await executeRender(canvas,{...job,appearance:sized},cache);
 assert.notDeepEqual(canvas.snapshot(),first,`${region} appearance changes ignored`);
}
const slidingCache={};
for(let offset=0;offset<24;offset++) {
 const job={...base,region:'trigraph',offset,length:128,appearance:{...defaultAppearance('trigraph'),hue:'byte2',opacity:'count',size:'byte3'}};
 const cached=new RenderCanvas(),fresh=new RenderCanvas();
 await executeRender(cached,job,slidingCache); await executeRender(fresh,job);
 assert.deepEqual(cached.pixels,fresh.pixels,'Sliding colored particles differ from a fresh render');
}
const engine=new RenderEngine(canvas);engine.version=2;engine.presented=0;
engine.latest={...base,appearanceKey:'new',sourceId:1,progressive:true};
assert.equal(engine.canPresent({id:1,job:{...engine.latest,appearanceKey:'old'}}),false,'Stale mappings must not be presented');
console.log('Appearance checks pass: cached mappings, default parity, independent entropy, all views, size/shape/opacity, stale-frame rejection.');
