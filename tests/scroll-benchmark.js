// CPU benchmark with a canvas double; excludes native browser/GPU compositing.
import { executeRender } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';
const bytes=new Uint8Array(2**21);let seed=12345;
for(let i=0;i<bytes.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;bytes[i]=seed&255;}
const source=new Blob([bytes]);
for(const region of ['linear','hilbert','digraph','trigraph']){
 const canvas=new RenderCanvas(),cache={};const times=[];
 for(let frame=0;frame<7;frame++){
  const started=performance.now();
  const result=await executeRender(canvas,{kind:'view',source,sourceId:1,offset:frame*1024,length:2**18,columns:512,rows:512,region,shaders:['entropy','brightness'],width:768,height:512,scale:1,encoding:'ascii'},cache);
  if(frame>1)times.push(performance.now()-started);
 }
 times.sort((a,b)=>a-b);console.log(region, 'scroll median ms:',times[2].toFixed(2));
}

const barCanvas=new RenderCanvas(),barCache={},times=[];
for(let frame=0;frame<9;frame++){
 const started=performance.now();
 await executeRender(barCanvas,{kind:'bar',source,sourceId:1,offset:frame*1024,length:2**20,width:48,height:768},barCache);
 if(frame>1)times.push(performance.now()-started);
}
times.sort((a,b)=>a-b);console.log('nested bar scroll median ms:',times[3].toFixed(2));

const largeCanvas=new RenderCanvas(),largeCache={},largeTimes=[];
for(let frame=0;frame<9;frame++){
 const started=performance.now();
 await executeRender(largeCanvas,{kind:'view',source,sourceId:1,offset:frame*1024,length:2**20,columns:1024,rows:768,region:'trigraph',shaders:[],rotation:{yaw:-0.6,pitch:0.45}},largeCache);
 if(frame>1)largeTimes.push(performance.now()-started);
}
largeTimes.sort((a,b)=>a-b);console.log('trigraph 1 MiB / 1024x768 steady scroll median ms:',largeTimes[3].toFixed(2));
