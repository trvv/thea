// Real Chromium/Canvas/OffscreenCanvas integration without an npm dependency.
// CHROMIUM_PATH overrides the system executable. Requires permission to launch a browser.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = new URL("../", import.meta.url).pathname;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path === "/fixture.bin")
      return new Response(
        Uint8Array.from(
          { length: 65536 },
          (_, i) => (i * 71 + (i >>> 3)) % 251,
        ),
      );
    if (path === "/browser.html")
      return new Response("<!DOCTYPE html><body></body>", {
        headers: { "content-type": "text/html" },
      });
    const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(root)) return new Response(null, { status: 403 });
    const body = Bun.file(file);
    return (await body.exists())
      ? new Response(body)
      : new Response(null, { status: 404 });
  },
});
const profile = await mkdtemp(join(tmpdir(), "thea-browser-"));
let browser, socket;
try {
  browser = Bun.spawn(
    [
      process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const errors = new Response(browser.stderr).text();
  const deadline = Date.now() + 15000;
  let port;
  while (Date.now() < deadline) {
    try {
      port = (await Bun.file(join(profile, "DevToolsActivePort")).text()).split(
        "\n",
      )[0];
      break;
    } catch {}
    if (browser.exitCode !== null) throw Error(await errors);
    await Bun.sleep(25);
  }
  assert(port, "Chromium did not expose its debugging port");
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  socket = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let serial = 0;
  const pending = new Map(),
    pageErrors = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      message.error
        ? reject(Error(JSON.stringify(message.error)))
        : resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown")
      pageErrors.push(message.params.exceptionDetails);
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(
        () => reject(Error(`CDP timeout: ${method}`)),
        30000,
      );
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 640,
    height: 480,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await call("Page.navigate", {
    url: `http://127.0.0.1:${server.port}/browser.html`,
  });
  while (!(await evaluate("document.readyState === 'complete'")))
    await Bun.sleep(25);
  const result = await evaluate(`(async()=>{
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
  for(const mode of ['scale','truncate'])for(const shape of ['circle','square']){
   const dimensions={width:{start:0,end:4,step:1,fit:true,mode},height:{start:0,end:3,step:1,fit:true,mode},depth:{start:0,end:6,step:1,fit:true,mode}};
   const job={...spec,length:64,configuration:{...spec.configuration,space:'cube',position:['column','row','slice'],footprint:'grid',dimensions},appearance:{...spec.appearance,hue:'slice',shape}};
   await executeRender(cpu,job,{});await executeRender(gpu,{...job,configuration:{...job.configuration,backend:'webgl'}},gpuCache);
   assert(gpuCache.pointBackend==='webgl','Dimension ranges did not use WebGL');
   const a=cpu.getContext('2d').getImageData(0,0,96,72).data,b=gpu.getContext('2d').getImageData(0,0,96,72).data;
   let maximum=0,total=0;for(let i=0;i<a.length;i++){const difference=Math.abs(a[i]-b[i]);maximum=Math.max(maximum,difference);total+=difference;}
   assert(maximum<=3&&total/a.length<0.1,'CPU/WebGL range mismatch '+mode+'/'+shape+': '+maximum+'/'+total/a.length);
  }
  const persistent={...spec,configuration:{...spec.configuration,backend:'webgl'}};
  await executeRender(gpu,persistent,gpuCache);
  const uploadCount=gpuCache.pointGPU.uploads;
  await executeRender(gpu,persistent,gpuCache);
  assert(gpuCache.pointGPU.uploads===uploadCount,'Repeated GPU frame uploaded unchanged instances');
  const changedCamera={...persistent,rotation:{yaw:1.1,pitch:0.1}};
  await executeRender(gpu,{...changedCamera,configuration:{...changedCamera.configuration,backend:'cpu'}},gpuCache);
  await executeRender(gpu,changedCamera,gpuCache);
  assert(gpuCache.pointGPU.uploads===uploadCount+1,'CPU intermediate projection left stale GPU instances');
  await executeRender(cpu,changedCamera,{});
  const cameraCpu=cpu.getContext('2d').getImageData(0,0,96,72).data,cameraGpu=gpu.getContext('2d').getImageData(0,0,96,72).data;
  assert(cameraCpu.every((value,index)=>Math.abs(value-cameraGpu[index])<=3),'Persistent GPU upload changed coverage');
  const empty={...spec,configuration:{...spec.configuration,dimensions:{width:{start:1000,end:1001,step:1,mode:'truncate',fit:true}}}};
  await executeRender(cpu,empty,{});await executeRender(gpu,{...empty,configuration:{...empty.configuration,backend:'webgl'}},gpuCache);
  assert(gpu.getContext('2d').getImageData(0,0,96,72).data.every((value,index)=>index%4===3?value===255:value===0),'Empty truncation window did not render black');
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
  assert(!scroll.contextItems().some(item=>item.label==='Layout'||item.label==='Grid'),'Layout override remains');
  const rangeBefore=[view.offset,view.length];
  scroll.contextItems().find(item=>item.label==='Space').action('circle');await view.render();
  let axes=scroll.contextItems().find(item=>item.label==='Position').items;
  axes[1].items.find(item=>item.label==='End (°)').action(90);await view.render();
  assert(view.pointConfiguration.dimensions.height.fit,'Radial Fit should default on');
  const fullCircle=pixels().slice();
  axes=scroll.contextItems().find(item=>item.label==='Position').items;
  axes[1].items.find(item=>item.label==='Fit').action();await view.render();
  assert(pixels().some((value,index)=>value!==fullCircle[index]),'Radial Fit did not change occupied extent');
  axes=scroll.contextItems().find(item=>item.label==='Position').items;
  axes[1].items.find(item=>item.label==='Range Mode').action('truncate');await view.render();
  assert(view.pointConfiguration.dimensions.height.mode==='truncate','Range mode was not stored');
  assert(view.offset===rangeBefore[0]&&view.length===rangeBefore[1],'Dimension ranges changed selected bytes');
  axes=scroll.contextItems().find(item=>item.label==='Position').items;
  axes[1].items.find(item=>item.label==='Reset Range').action();await view.render();
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
  scroll.refreshMenu();scroll.menu.open(10,10);
  scroll.menu.controls().find(button=>button.textContent.includes('Preset')).click();
  scroll.menu.childMenu.controls().find(button=>button.textContent.includes('Load')).click();
  scroll.menu.childMenu.childMenu.controls().find(button=>button.textContent.includes('Hilbert 3D')).click();
  await view.render();
  assert(view.region==='hilbert3d'&&view.spatial&&view.pointConfiguration.population==='bytes','Hilbert 3D preset menu failed');
  assert(view.effectiveAppearance.lightness==='value'&&view.pointConfiguration.position[2].input.op==='hilbert3d','Hilbert 3D preset lost its coordinate or shading mappings');
  view.pointConfiguration={...view.pointConfiguration,sampleLimit:64};await view.render();
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
  const repeated=new DataScroll(new Blob([new Uint8Array(4096).fill(1)]),512);document.body.append(repeated);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  repeated.view.renderer.budget=0;repeated.view.applyPreset('trigraph');
  repeated.view.pointConfiguration={...repeated.view.pointConfiguration,position:['column','row','slice']};
  await repeated.view.render();
  assert(repeated.view.dimensionRanges.width.end===1,'Resolved range feedback used selected-byte count instead of actual tuple count');
  repeated.remove();
  // Actual click popups must work in both execution threads and describe the displayed source.
  const {hitPoint}=await import('/point-inspection.js');
  for(const backend of ['local','worker']) {
   const inspectScroll=new DataScroll(new Blob([Uint8Array.from({length:16},(_,i)=>i*11)]),16);
   inspectScroll.barCount=0;
   const inspectedView=inspectScroll.view;
   inspectedView.applyPreset('linear');
   inspectedView.renderer.budget=backend==='local'?Infinity:0;
   if(backend==='local')inspectedView.renderer.supported=false;
   document.body.append(inspectScroll);
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   await inspectedView.render();
   const clickPoint=async()=>{
    const reference={},job=inspectedView.renderer.presentedJob;
    await executeRender(document.createElement('canvas'),job,reference);
    let coordinate;
    for(let i=0;i<reference.preparedPoints.size;i++) {
     const projected=reference.pointRaster.projected,x=projected[i*4],y=projected[i*4+1];
     if(hitPoint(reference.preparedPoints,reference.pointRaster.projection,x,y)>=0){coordinate=[x,y];break;}
    }
    assert(coordinate,'No inspectable reference point');
    const bounds=inspectedView.canvas.getBoundingClientRect();
    inspectedView.canvas.dispatchEvent(new MouseEvent('click',{button:0,bubbles:true,composed:true,
     clientX:bounds.left+coordinate[0]*bounds.width/job.columns,clientY:bounds.top+coordinate[1]*bounds.height/job.rows}));
    for(let i=0;i<200&&!inspectedView.inspector?.matches(':popover-open');i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert(inspectedView.inspector?.matches(':popover-open'),backend+' click popup did not open');
    return inspectedView.inspector;
   };
   let popup=await clickPoint();
   assert(popup.textContent.includes('Byte 0x00 @ 0x0')&&popup.textContent.includes('Source Offset'),'Byte popup lacks value/index: '+popup.querySelector('strong')?.textContent+' '+JSON.stringify(inspectedView.renderer.presentedJob.configuration));
   assert(popup.textContent.includes('Hue: Local Entropy')&&popup.textContent.includes('Lightness: Byte Value'),'Popup lacks trait associations');
   assert([...popup.querySelectorAll('details')].every(section=>!section.open),'Inspection sections must start collapsed');
   assert(popup.textContent.includes('0 (0x00, ASCII NUL)'),'Byte inspection lacks hex/control representation');
   const origin=popup.querySelector('details');origin.open=true;
   assert(getComputedStyle(origin.querySelector('th')).textAlign==='left','Inspection field names are not left aligned');
   const {inspectionContent}=await import('/inspection-content.js');
   const representations=inspectionContent({point:{population:'bytes',index:0,sourceOffset:0,byteValue:65,tuple:[10,32,127,255]},traits:[],nodes:[],rendering:{}});
   assert(representations.textContent.includes('65 (0x41, ASCII "A")')&&representations.textContent.includes('0x0A, ASCII LF')
    &&representations.textContent.includes('0x20, ASCII " "')&&representations.textContent.includes('0x7F, ASCII DEL')
    &&representations.textContent.includes('0xFF, non-ASCII'),'Byte representations are incorrect');
   assert(popup.getAttribute('role')==='dialog'&&inspectScroll.shadowRoot.activeElement===inspectedView,'Popup focus escaped the view');
   inspectScroll.source=new Blob([new TextEncoder().encode('😀')]);await inspectedView.render();
   popup=await clickPoint();
   assert(popup.textContent.includes('UTF-8')&&popup.textContent.includes('U+1F600')&&popup.textContent.includes('😀'),'UTF-8 interpretation missing in '+backend+' popup');
   assert(popup.textContent.includes('0xF0')&&popup.textContent.includes('Encoded Length'),'UTF-8 source bytes/span missing');
   assert([...popup.querySelectorAll('details')].every(section=>!section.open),'UTF-8 details should start collapsed');
   inspectedView.applyPreset('dft');await inspectedView.render();
   assert(!popup.matches(':popover-open'),'Changed view retained an old popup');
   popup=await clickPoint();
   assert(popup.textContent.includes('Bin ')&&popup.textContent.includes('Real')&&popup.textContent.includes('Imaginary'),'DFT popup lacks coefficient provenance');
   if(backend==='worker')assert(inspectedView.renderer.worker,'Inspection did not exercise a real worker');
   popup.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,composed:true}));
   assert(!popup.matches(':popover-open')&&inspectScroll.shadowRoot.activeElement===inspectedView,'Escape did not dismiss inspection/restore focus');
   inspectScroll.remove();assert(!inspectedView.renderer.worker&&!popup.matches(':popover-open'),'Disconnect retained popup/worker');
  }
  return {sourceBytes:source.size,population:before};
 })()`);
  await evaluate(`(async()=>{
    const {DataScroll}=await import('/main.js');
    const {packedPixels}=await import('/packed-pixels.js');
    const {byteFrequencyTable}=await import('/byte-frequency.js');
    const {executeRender}=await import('/rendering.js');
    const assert=(condition,message)=>{if(!condition)throw Error(message)};
    const host=new DataScroll(new Blob([Uint8Array.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])]),16);
    host.barCount=0;document.body.append(host);
    host.applyTemplate(packedPixels({format:'rgba32',width:2}));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await host.view.render();
    const cache={},job=host.view.renderer.presentedJob;
    await executeRender(document.createElement('canvas'),job,cache);
    assert(cache.preparedPoints.size===4,'Packed pixel population incorrect');
    assert([...cache.preparedPoints.colors.slice(0,4)].join(',')==='255,0,0,255','RGB output changed source colors');
    const p=cache.pointRaster.projected,bounds=host.view.canvas.getBoundingClientRect();
    await host.view.inspectAt(bounds.left+p[0]*bounds.width/job.columns,bounds.top+p[1]*bounds.height/job.rows);
    const popup=host.view.inspector;
    assert(popup.textContent.includes('Record 0')&&popup.textContent.includes('Red:')&&popup.textContent.includes('Green:'),'Packed inspector lacks RGB provenance');
    assert(popup.textContent.includes('Occurrences')&&popup.textContent.includes('Context'),'Occurrence/context controls missing');
    host.view.closeInspection();
    host.view.pointConfiguration={...host.view.pointConfiguration,footprint:'point',position:[{op:'constant',value:0.5},{op:'constant',value:0.5},'none']};
    host.view.appearance={...host.view.effectiveAppearance,density:{mode:'all'}};await host.view.render();
    let densityJob=host.view.renderer.presentedJob;
    let aggregate=await host.view.renderer.inspect(densityJob.columns/2,densityJob.rows/2);
    assert(aggregate.rendering.accumulation.contributorCount===4,'All-depth density lost overlapping contributions');
    assert(aggregate.rendering.accumulation.reference>0,'Displayed density reference was not preserved');
    host.view.appearance={...host.view.effectiveAppearance,density:{...host.view.effectiveAppearance.density,mode:'front'}};await host.view.render();
    densityJob=host.view.renderer.presentedJob;aggregate=await host.view.renderer.inspect(densityJob.columns/2,densityJob.rows/2);
    assert(aggregate.rendering.accumulation.contributorCount===1,'Front-layer density flag did not change ownership');
    host.toggleComparison();await host.comparisonView.render();
    const comparison=host.comparisonView;
    assert(comparison.offset===host.view.offset&&comparison.length===host.view.length,'Comparison selection drift');
    comparison.canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,composed:true,clientX:100,clientY:100}));
    assert(host.editingView===comparison,'Comparison context did not target its view');
    host.menu.closeRoot();
    host.applyTemplate(byteFrequencyTable());await comparison.render();
    assert(comparison.pointConfiguration.population==='symbols'&&host.view.pointConfiguration.population==='records','Comparison template changed primary');
    const left=host.view.getBoundingClientRect(),right=comparison.getBoundingClientRect();
    assert(left.width>0&&right.width>0&&right.left>=left.right-1,'Comparison panes overlap');
    host.source=new Blob([new Uint8Array(512).fill(65)]);await Promise.all([host.view.render(),comparison.render()]);
    assert(comparison.source===host.view.source&&comparison.length===host.view.length,'Comparison replacement source mismatch');
    const refs=await import('/reference-models.js'),previousPrompt=window.prompt;
    try{
      window.prompt=()=> 'Browser Reference';
      await host.referenceItems()[0].items[0].action();
      const model=refs.readLibrary().models.find(model=>model.name==='Browser Reference');
      assert(model,'Reference training menu did not save a model');
      host.referenceItems().find(item=>item.label==='Browser Reference').items.find(item=>item.label==='Surprise Hue').action();
      await comparison.render();
      assert(comparison.renderer.presentedJob.referenceModels[0].id===model.id,'Reference artifact was not resolved into the displayed job');
      refs.deleteModel(model.id);
    }finally{window.prompt=previousPrompt;}
    host.toggleComparison();assert(!comparison.renderer.worker,'Comparison removal retained worker');host.remove();
  })()`);
  // Real pointer input verifies that capture/preventDefault still allows stationary 3D clicks.
  const pointLocation = await evaluate(`(async()=>{
  const {DataScroll}=await import('/main.js'),{executeRender}=await import('/rendering.js'),{hitPoint}=await import('/point-inspection.js');
  const fixture=window.inspectionFixture=new DataScroll(new Blob([Uint8Array.from({length:64},(_,i)=>i*3)]),64);
  fixture.barCount=0;fixture.view.applyPreset('hilbert3d');fixture.view.renderer.budget=0;document.body.append(fixture);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await fixture.view.render();
  const view=fixture.view,cache={},job=view.renderer.presentedJob;await executeRender(document.createElement('canvas'),job,cache);
  const bounds=view.canvas.getBoundingClientRect();
  for(let i=0;i<cache.preparedPoints.size;i++) {
   const p=cache.pointRaster.projected,x=p[i*4],y=p[i*4+1];
   if(hitPoint(cache.preparedPoints,cache.pointRaster.projection,x,y)>=0)return {x:bounds.left+x*bounds.width/job.columns,y:bounds.top+y*bounds.height/job.rows};
  }
  throw Error('No 3D point to click');
 })()`);
  await call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...pointLocation,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...pointLocation,
    button: "left",
    clickCount: 1,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...pointLocation,
    button: "left",
    clickCount: 1,
  });
  const inspectionDeadline = Date.now() + 5000;
  while (
    Date.now() < inspectionDeadline &&
    !(await evaluate(
      "window.inspectionFixture.view.inspector?.matches(':popover-open')",
    ))
  )
    await Bun.sleep(10);
  assert(
    await evaluate(
      "window.inspectionFixture.view.inspector?.matches(':popover-open')",
    ),
    "A real stationary 3D click failed to inspect",
  );
  const yaw = await evaluate("window.inspectionFixture.view.rotation.yaw");
  await evaluate("window.inspectionFixture.view.closeInspection()");
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...pointLocation,
    button: "left",
    clickCount: 1,
  });
  const dragged = { x: pointLocation.x + 20, y: pointLocation.y + 10 };
  await call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...dragged,
    button: "left",
    buttons: 1,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...dragged,
    button: "left",
    clickCount: 1,
  });
  assert(
    (await evaluate("window.inspectionFixture.view.rotation.yaw")) !== yaw,
    "Real pointer drag failed to rotate",
  );
  assert(
    !(await evaluate(
      "window.inspectionFixture.view.inspector?.matches(':popover-open')",
    )),
    "Camera drag opened inspection",
  );
  await evaluate(
    "window.inspectionFixture.remove();delete window.inspectionFixture",
  );
  const persisted = await evaluate(`(async()=>{
    const assert=(value,message)=>{if(!value)throw Error(message);};
    const {DataScroll}=await import('/main.js');
    const {storageKey,readLibrary}=await import('/preset-library.js');
    localStorage.removeItem(storageKey);
    const host=new DataScroll(new Blob([Uint8Array.from({length:256},(_,i)=>i%251)]),64);
    host.barCount=3;host.view.applyPreset('hilbert3d');
    host.view.pointConfiguration={...host.view.pointConfiguration,sampleLimit:64};
    host.view.setFactor('Neighbor',{op:'byte',offset:{op:'offset'}});
    host.view.appearance={...host.view.effectiveAppearance,hue:{op:'entropy',offset:{op:'offset'},window:64}};
    document.body.append(host);await host.view.render();
    const prompts=[],alerts=[],fallback=[];
    const originalPrompt=window.prompt,originalAlert=window.alert;
    const originalClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');
    let copied;
    window.prompt=(message,value)=>{if(message==='Preset JSON'&&value)fallback.push(value);return prompts.length?prompts.shift():null;};
    window.alert=message=>alerts.push(message);
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});
    const run=async(...labels)=>{
      host.refreshMenu();host.menu.open(10,10);let menu=host.menu;
      for(const label of ['Preset',...labels]) {
        const button=menu.controls().find(control=>control.textContent.includes(label));
        assert(button,'Missing preset command '+label);button.click();menu=menu.childMenu;
      }
      await new Promise(resolve=>setTimeout(resolve,0));
    };
    try {
      prompts.push('Durable Cube');await run('Save As');
      assert(readLibrary().presets.length===1,'Save As did not persist');
      prompts.push('Cube Copy');await run('Manage','Durable Cube','Duplicate');
      assert(readLibrary().presets.length===2,'Duplicate did not persist');
      host.view.appearance={...host.view.effectiveAppearance,hue:{op:'entropy',offset:{op:'offset'},window:96}};
      await run('Manage','Durable Cube','Update');
      await run('Load','Saved','Cube Copy');
      assert(host.view.effectiveAppearance.hue.window===64,'Copy was aliased to updated original');
      prompts.push('Other Cube');await run('Manage','Cube Copy','Rename');
      await run('Manage','Other Cube','Delete');
      assert(readLibrary().presets.length===1,'Delete did not persist');
      await run('Manage','Durable Cube','Copy JSON');
      assert(JSON.parse(copied).profile.appearance.hue.window===96,'Clipboard copy lost settings');
      prompts.push(copied,'Imported Cube');await run('Import JSON');
      assert(readLibrary().presets.length===2&&host.view.effectiveAppearance.hue.window===96,'Import failed');
      const unchanged=localStorage.getItem(storageKey);
      prompts.push(null);await run('Save As');assert(localStorage.getItem(storageKey)===unchanged,'Canceled save changed data');
      prompts.push('Durable Cube');await run('Save As');
      assert(alerts.length===1&&localStorage.getItem(storageKey)===unchanged,'Name collision overwrote preset');
      const originalSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key===storageKey)throw new DOMException('Preset quota exceeded','QuotaExceededError');return originalSetItem.call(this,key,value);};
      try {prompts.push('Quota failure');await run('Save As');}
      finally {Storage.prototype.setItem=originalSetItem;}
      assert(alerts.length===2&&localStorage.getItem(storageKey)===unchanged,'Quota failure erased prior presets or failed silently');
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
      await run('Copy JSON');assert(fallback.length===1&&JSON.parse(fallback[0]).barCount===3,'Clipboard failure did not provide copyable JSON');
      return {snapshot:JSON.stringify(host.presetSnapshot()),name:'Imported Cube'};
    }finally {
      host.remove();window.prompt=originalPrompt;window.alert=originalAlert;
      if(originalClipboard)Object.defineProperty(navigator,'clipboard',originalClipboard);else delete navigator.clipboard;
    }
  })()`);
  await call("Page.navigate", {
    url: `http://127.0.0.1:${server.port}/#fixture.bin`,
  });
  const loadedDeadline = Date.now() + 10000;
  while (
    Date.now() < loadedDeadline &&
    !(await evaluate(
      "document.querySelector('data-scroll')?.source?.size === 65536",
    ))
  )
    await Bun.sleep(25);
  assert(
    await evaluate(
      "document.querySelector('data-scroll')?.source?.size === 65536",
    ),
    "Bootstrap failed to mount/load the fragment",
  );
  assert.equal(
    await evaluate(
      "JSON.stringify(document.querySelector('data-scroll').presetSnapshot())",
    ),
    persisted.snapshot,
    "Browser refresh did not restore the saved preset and bar count",
  );
  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  console.log(
    "Browser checks pass: component import, real worker/bitmap, CPU/WebGL parity and fallback, mixed populations, profiles, snapshots, sample/quality boundaries, source replacement, DPR/text, point inspection, real 3D click/drag, native popover keyboard focus, persistent preset CRUD/copy/import and refresh, disconnect.",
    result,
  );
} finally {
  socket?.close();
  browser?.kill();
  if (browser) await browser.exited;
  server.stop(true);
  await rm(profile, { recursive: true, force: true });
}
