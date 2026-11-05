import assert from 'node:assert/strict';
import { AdaptiveResolution } from '../adaptive-resolution.js';
import { RenderCanvas } from './render-canvas.js';

const adaptive=new AdaptiveResolution();
for(let i=0;i<10;i++)adaptive.record(100,1);
assert.equal(adaptive.scale,1,'Idle render cost reduced resolution');
adaptive.touch();
for(let i=0;i<20;i++)assert.equal(adaptive.record(8,1),false);
assert.equal(adaptive.scale,1,'Fast movement lost detail');
adaptive.record(40,1);assert.equal(adaptive.scale,1,'One slow frame lowered resolution');
adaptive.record(8,1);assert.equal(adaptive.scale,1);
adaptive.record(40,1);assert.equal(adaptive.record(40,1),true);
const lowered=adaptive.scale;
assert(lowered<1&&lowered>=0.25);
assert.equal(adaptive.record(500,lowered),false,'Cache rebuild frame changed quality');
for(let i=0;i<6;i++)adaptive.record(8,adaptive.scale);
assert(adaptive.scale>lowered,'Fast frames did not recover detail');
const recovered=adaptive.scale;
assert.equal(adaptive.record(100,lowered),false,'Old resolution sample changed quality');
assert.equal(adaptive.scale,recovered);
assert.equal(adaptive.settle(),true);assert.equal(adaptive.scale,1);assert.equal(adaptive.moving,false);
const fixedCost=new AdaptiveResolution();fixedCost.touch();fixedCost.record(100,1);fixedCost.record(100,1);
fixedCost.record(100,fixedCost.scale); // discard transition
fixedCost.record(100,fixedCost.scale);fixedCost.record(100,fixedCost.scale);
assert.equal(fixedCost.scale,1,'No-benefit reduction was retained');
assert(fixedCost.locked);

const handlers={};
globalThis.HTMLElement=class{
 constructor(){this.events={};this.style={};this.clientWidth=1800;this.clientHeight=1000;this.isConnected=true;}
 addEventListener(type,handler){this.events[type]=handler;}
 dispatchEvent(event){this.events[event.type]?.(event);}
 setAttribute(){}
 attachShadow(){return this.shadowRoot={querySelector:()=>new RenderCanvas()};}
};
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
globalThis.customElements={define(){}};
globalThis.document={addEventListener(){}};
globalThis.devicePixelRatio=2;
const {DataScrollView}=await import('../main.js');
const view=new DataScrollView();
const jobs=[];
view.renderer.render=async job=>{jobs.push(job);return true;};
view.region='trigraph';
const source=new Blob([new Uint8Array(256)]);
const layout=view.layout(32,256);
view.requestedLength=32;
view.setWindow(source,5,32,{...layout,limit:256});await view.render();
assert.equal(jobs.at(-1).columns,3600);assert.equal(jobs.at(-1).rows,2000);
assert.equal(jobs.at(-1).pointScale,2);

// Deterministic input-idle timers and animation frames avoid timing-sensitive tests.
const nativeSetTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout;
let clock=0,serial=0;
const timers=new Map(),frames=new Map();
globalThis.setTimeout=(callback,delay)=>{timers.set(++serial,{callback,due:clock+delay});return serial;};
globalThis.clearTimeout=id=>timers.delete(id);
globalThis.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
try{
 view.setWindow(source,10,32,{...layout,limit:256});await view.render();
 assert(view.resolution.moving);
 const full=jobs.at(-1);
 view.renderer.onFrame({job:full,duration:40});view.renderer.onFrame({job:full,duration:40});
 assert(view.resolution.scale<1);assert.equal(frames.size,1);
 const [frameId,frame]=frames.entries().next().value;frames.delete(frameId);frame();await Promise.resolve();
 const reduced=jobs.at(-1);
 assert(reduced.columns<3600&&reduced.rows<2000);
 assert.equal(reduced.pointScale,2*view.resolution.scale,'Particle size changed with render quality');
 assert.equal(view.windowLayout.columns,3600,'Render quality changed selection layout');
 assert.equal(view.offset,10);assert.equal(view.length,32);
 assert.equal(reduced.axes.join(),full.axes.join());
 clock=100;view.noteMovement();
 clock=279;
 for(const {due} of timers.values())assert(due>clock);
 clock=281;
 for(const [id,timer]of [...timers])if(timer.due<=clock){timers.delete(id);timer.callback();}
 await Promise.resolve();
 assert.equal(view.resolution.scale,1);assert.equal(view.resolution.moving,false);
 assert.equal(jobs.at(-1).columns,3600);assert.equal(jobs.at(-1).rows,2000);
 assert.equal(jobs.at(-1).interacting,false);
 assert.equal(frames.size,0);
 view.noteMovement();view.disconnectedCallback();
 assert.equal(timers.size,0);assert.equal(frames.size,0);
}finally{
 globalThis.setTimeout=nativeSetTimeout;globalThis.clearTimeout=nativeClearTimeout;
 delete globalThis.requestAnimationFrame;delete globalThis.cancelAnimationFrame;
}
console.log('Adaptive resolution checks pass: native high-DPI detail, fast-motion quality, sustained slow-frame response, cache warmup, recovery, no-benefit rollback, idle restoration, stable particles/selection, cleanup.');
