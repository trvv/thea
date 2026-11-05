// Non-gating CPU benchmark. Optional repository path allows identical fixtures against an older checkout.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.argv[2]?pathToFileURL(resolve(process.argv[2])+'/'):new URL('../',import.meta.url);
const {executeRender}=await import(new URL('rendering.js',root));
const {presetConfiguration}=await import(new URL('point-configuration.js',root));
const {defaultAppearance}=await import(new URL('appearance.js',root));
const {RenderCanvas}=await import(new URL('tests/render-canvas.js',root));
let seed=123;
const bytes=Uint8Array.from({length:2**19},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
const source=new Blob([bytes]),median=values=>values.sort((a,b)=>a-b)[values.length>>1];
for(const space of ['square','cube'])for(const mode of ['scroll','appearance','repeat','camera']) {
 const canvas=new RenderCanvas(),cache={},times=[],stages={preparation:[],projection:[],sorting:[],rasterization:[]};
 const configuration={...presetConfiguration('linear'),space,footprint:space==='square'?'grid':'point',sampleLimit:65536,
  position:space==='square'?['column','row','none']:['value','byte2','byte3']};
 const appearance={...defaultAppearance('linear'),hue:'value',lightness:'entropy'};
 const base={kind:'view',source,sourceId:1,offset:0,length:2**18,columns:512,rows:384,region:'linear',shaders:['entropy','brightness'],
  configuration,appearance,sampleLayout:{columns:256,rows:256},rotation:{yaw:-0.6,pitch:0.45}};
 let cold;
 for(let frame=0;frame<20;frame++) {
  const job={...base,offset:mode==='scroll'?frame*32:0,
   rotation:mode==='camera'?{yaw:-0.6+frame*0.02,pitch:0.45}:base.rotation,
   appearance:mode==='appearance'?{...appearance,hue:frame%2?'byte2':'value'}:appearance};
  const start=performance.now(),metrics=await executeRender(canvas,job,cache),elapsed=performance.now()-start;
  if(frame===0)cold=elapsed;
  if(frame>=5) {
   times.push(elapsed);
   for(const stage of Object.keys(stages))if(metrics.timings)stages[stage].push(metrics.timings[stage]);
  }
 }
 const points=cache.preparedPoints,raster=cache.pointRaster;
 const buffers=[points.positions,points.geometry?.indices,points.colors,points.sizes,raster.projected,raster.order,raster.image?.data];
 const retained=[...new Set(buffers.filter(Boolean).map(view=>view.buffer))].reduce((sum,buffer)=>sum+buffer.byteLength,0);
 console.log(`${space}/${mode}: cold ${cold.toFixed(2)} ms; steady median ${median(times).toFixed(2)} ms; mark/raster ${(retained/2**20).toFixed(2)} MiB`);
 if(stages.preparation.length)console.log('  stages ms:',Object.fromEntries(Object.entries(stages).map(([name,values])=>[name,+median(values).toFixed(2)])));
}
// Resolve every preset through the same stages with a modest point budget.
for(const region of ['linear','hilbert','hilbert3d','digraph','dft','trigraph']) {
 const configuration={...presetConfiguration(region),sampleLimit:4096},cache={},canvas=new RenderCanvas(),times=[];
 for(let frame=0;frame<10;frame++) {
  const start=performance.now();
  await executeRender(canvas,{kind:'view',source,sourceId:1,offset:frame*32,length:65536,columns:256,rows:192,region,
   shaders:['entropy','brightness'],configuration,sampleLayout:{columns:64,rows:64}},cache);
  if(frame>=3)times.push(performance.now()-start);
 }
 console.log(`${region}/4096-point scroll median: ${median(times).toFixed(2)} ms`);
}
const overviewSource=new Blob([new Uint8Array(8*2**20)]),overviewCache={},canvas=new RenderCanvas();
const cold=await executeRender(canvas,{kind:'bar',source:overviewSource,width:1,height:1},overviewCache);
const warm=await executeRender(canvas,{kind:'bar',source:overviewSource,width:2,height:1},overviewCache);
console.log('8 MiB overview work:',{cold:cold.work,resized:warm.work});
