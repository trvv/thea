// Real Chromium/Canvas/OffscreenCanvas integration without an npm dependency.
// CHROMIUM_PATH overrides the system executable. Requires permission to launch a browser.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=new URL('../',import.meta.url).pathname;
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const path=decodeURIComponent(new URL(request.url).pathname);
 if(path==='/fixture.bin')return new Response(Uint8Array.from({length:65536},(_,i)=>(i*71+(i>>>3))%251));
 if(path==='/browser.html')return new Response('<!DOCTYPE html><body></body>',{headers:{'content-type':'text/html'}});
 const file=resolve(root,`.${path==='/'?'/index.html':path}`);
 if(!file.startsWith(root))return new Response(null,{status:403});
 const body=Bun.file(file);return await body.exists()?new Response(body):new Response(null,{status:404});
}});
const profile=await mkdtemp(join(tmpdir(),'thea-browser-'));
let browser,socket;
try{
 browser=Bun.spawn([process.env.CHROMIUM_PATH||'/usr/bin/chromium-browser','--headless','--no-sandbox','--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader','--use-angle=swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdout:'ignore',stderr:'pipe'});
 const errors=new Response(browser.stderr).text();
 const deadline=Date.now()+15000;let port;
 while(Date.now()<deadline){
  try{port=(await Bun.file(join(profile,'DevToolsActivePort')).text()).split('\n')[0];break;}catch{}
  if(browser.exitCode!==null)throw Error(await errors);
  await Bun.sleep(25);
 }
 assert(port,'Chromium did not expose its debugging port');
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let serial=0;const pending=new Map(),pageErrors=[];
 socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const {resolve,reject,timer}=pending.get(message.id);pending.delete(message.id);clearTimeout(timer);message.error?reject(Error(JSON.stringify(message.error))):resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')pageErrors.push(message.params.exceptionDetails);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>reject(Error(`CDP timeout: ${method}`)),30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{
  const response=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
 };
 await call('Runtime.enable');await call('Page.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:640,height:480,deviceScaleFactor:2,mobile:false});
 await call('Page.navigate',{url:`http://127.0.0.1:${server.port}/browser.html`});
 while(!await evaluate("document.readyState === 'complete'"))await Bun.sleep(25);
 const result=await evaluate(`(async()=>{
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const {DataScroll}=await import('/main.js');
  assert(document.querySelectorAll('data-scroll').length===0,'Component import mounted the demo');
  const source=await(await fetch('/fixture.bin')).blob();
  const {executeRender}=await import('/rendering.js');
  const {presetConfiguration}=await import('/point-configuration.js');
  const {defaultAppearance}=await import('/appearance.js');
  const {hilbert3DCoordinate}=await import('/recipes.js');
  const {recipeMenu}=await import('/recipe-menu.js');
  const gpuCache={};
  const cpu=document.createElement('canvas'),gpu=document.createElement('canvas');
  const spec={kind:'view',source,offset:0,length:128,region:'linear',columns:96,rows:72,width:96,height:72,
   scale:1,pointScale:1,sampleLayout:{columns:16,rows:8},shaders:[],
   configuration:{...presetConfiguration('linear'),space:'cube',footprint:'point'},
   appearance:{...defaultAppearance('linear'),hue:'value',lightness:'byte2',opacity:'position',shape:'circle',size:'byte3'}};
  for(const space of ['square','circle','cube','sphere','cylinder'])for(const shape of ['circle','square']){
   const job={...spec,configuration:{...spec.configuration,space},appearance:{...spec.appearance,shape}};
   await executeRender(cpu,job,{});
   await executeRender(gpu,{...job,configuration:{...job.configuration,backend:'webgl'}},gpuCache);
   assert(gpuCache.pointBackend==='webgl','WebGL backend fell back unexpectedly');
   const a=cpu.getContext('2d').getImageData(0,0,96,72).data,b=gpu.getContext('2d').getImageData(0,0,96,72).data;
   let maximum=0,total=0;for(let i=0;i<a.length;i++){const difference=Math.abs(a[i]-b[i]);maximum=Math.max(maximum,difference);total+=difference;}
   assert(maximum<=3&&total/a.length<0.1,'CPU/WebGL raster mismatch '+space+'/'+shape+': '+maximum+'/'+total/a.length);
  }
  gpuCache.pointGPU.gl.getExtension('WEBGL_lose_context').loseContext();
  await new Promise(resolve=>setTimeout(resolve,50));
  await executeRender(gpu,{...spec,configuration:{...spec.configuration,backend:'webgl'}},gpuCache);
  assert(gpuCache.pointBackend==='cpu','Context loss did not fall back');
  const scroll=new DataScroll(source,4096);document.body.append(scroll);
  const view=scroll.view;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  view.renderer.budget=0;
  view.applyPreset('trigraph');
  const before=view.pointConfiguration.population;
  view.appearance={...view.effectiveAppearance,lightness:{op:'factor',name:'tripleCount'}};
  assert(view.pointConfiguration.population===before&&before==='triples','Recipe edit changed population');
  await view.render();assert(view.renderer.worker,'Actual worker was not used');
  const pixels=()=>view.canvas.getContext('2d').getImageData(0,0,view.canvas.width,view.canvas.height).data;
  assert(pixels().some((v,i)=>i%4!==3&&v>0),'Worker frame is empty');
  const copy=view.pointConfiguration;copy.position[0]='none';assert(view.pointConfiguration.position[0]!=='none','Getter exposed mutable state');
  const profile=view.exportProfile();view.importProfile(JSON.stringify(profile));
  assert(JSON.stringify(view.exportProfile())===JSON.stringify(profile),'Profile round trip changed settings');
  const old=view.exportProfile();try{view.importProfile({...old,version:99});}catch{}
  assert(JSON.stringify(view.exportProfile())===JSON.stringify(old),'Invalid profile changed state');
  view.pointConfiguration={...view.pointConfiguration,population:'bytes',sampleLimit:64,space:'cube',backend:'webgl',
   position:[0,1,2].map(axis=>hilbert3DCoordinate(axis))};
  view.focus();
  scroll.menu.items=recipeMenu('Factor',{op:'pointIndex'},{},expression=>{
   view.pointConfiguration={...view.pointConfiguration,position:[...view.pointConfiguration.position.slice(0,2),expression]};
  }).items;
  scroll.menu.open(10,10);
  scroll.menu.controls().find(button=>button.textContent.includes('Transform')).click();
  scroll.menu.childMenu.controls().find(button=>button.textContent.includes('Hilbert 3D')).click();
  const curveMenu=scroll.menu.childMenu.childMenu;
  assert(curveMenu?.matches(':popover-open'),'3D Hilbert component menu did not open');
  curveMenu.controls().find(button=>button.textContent==='Z').click();
  assert(view.pointConfiguration.position[2].input.op==='hilbert3d'&&view.pointConfiguration.position[2].component===2,'3D Hilbert menu chose the wrong component');
  const curveProfile=JSON.stringify(view.exportProfile());view.importProfile(curveProfile);
  assert(JSON.stringify(view.exportProfile())===curveProfile,'3D Hilbert profile did not round trip');
  const range=[view.offset,view.length];
  view.noteMovement();view.resolution.scale=0.5;await view.render();
  assert(view.offset===range[0]&&view.length===range[1],'Quality changed selection');
  assert(view.resolvedSampleLayout.columns*view.resolvedSampleLayout.rows<=64,'Sample budget exceeded');
  view.resetResolution();
  const stale=view.render();scroll.source=new Blob([new Uint8Array(8192).fill(255)]);await view.render();await stale;
  assert(view.renderer.latest.source===scroll.source,'Source replacement lost');
  const expected=document.createElement('canvas');
  await executeRender(expected,{...view.renderer.latest,configuration:{...view.renderer.latest.configuration,backend:'cpu'}});
  const expectedPixels=expected.getContext('2d').getImageData(0,0,expected.width,expected.height).data;
  assert(pixels().every((value,index)=>Math.abs(value-expectedPixels[index])<=3),'Stale source pixels were presented');
  view.applyPreset('linear');view.shaders=['brightness','hex'];await view.render();
  assert(view.canvas.width===Math.round(view.clientWidth*devicePixelRatio),'Text raster did not follow DPR');
  view.focus();scroll.refreshMenu();scroll.menu.open(10,10);
  assert(scroll.menu.matches(':popover-open'),'Native menu did not open');
  const preset=scroll.menu.controls().find(control=>control.textContent.includes('Preset'));
  preset.focus();preset.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert(scroll.menu.childMenu?.matches(':popover-open'),'Keyboard did not open submenu');
  const active=scroll.shadowRoot.activeElement;
  assert(scroll.menu.childMenu.controls().includes(active),'Submenu did not receive focus');
  active.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert(!scroll.menu.childMenu&&scroll.shadowRoot.activeElement===preset,'Escape did not restore parent focus');
  scroll.menu.closeRoot();assert(scroll.shadowRoot.activeElement===view,'Menu did not restore view focus');
  scroll.remove();assert(!view.renderer.worker,'Disconnect retained worker');
  return {sourceBytes:source.size,population:before};
 })()`);
 await call('Page.navigate',{url:`http://127.0.0.1:${server.port}/#fixture.bin`});
 const loadedDeadline=Date.now()+10000;
 while(Date.now()<loadedDeadline&&!await evaluate("document.querySelector('data-scroll')?.source?.size === 65536"))await Bun.sleep(25);
 assert(await evaluate("document.querySelector('data-scroll')?.source?.size === 65536"),'Bootstrap failed to mount/load the fragment');
 assert.equal(pageErrors.length,0,JSON.stringify(pageErrors));
 console.log('Browser checks pass: component import, real worker/bitmap, CPU/WebGL parity and fallback, mixed populations, profiles, snapshots, sample/quality boundaries, source replacement, DPR/text, native popover keyboard focus, disconnect.',result);
}finally{
 socket?.close();browser?.kill();if(browser)await browser.exited;server.stop(true);await rm(profile,{recursive:true,force:true});
}
