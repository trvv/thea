import { RenderCanvas } from './render-canvas.js';
const registry=new Map();
class Node {
 constructor(){this.style={};this.children=[];this.events={};this.attributes={};this.clientWidth=800;this.clientHeight=600;this.isConnected=false;}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 addEventListener(type,handler){this.events[type]=handler;}
 dispatchEvent(event){this.events[event.type]?.(event);}
 setAttribute(key,value){this.attributes[key]=value;}
 focus(){}
 setPointerCapture(id){this.capture=id;}
 hasPointerCapture(id){return this.capture===id;}
 releasePointerCapture(){this.capture=null;}
 attachShadow(){const root=new Node();const cache=new Map();root.querySelector=selector=>{
  if(!cache.has(selector))cache.set(selector,selector==='canvas'?canvas():selector==='data-scroll-view'?new (registry.get(selector))():new Node());
  return cache.get(selector);
 };return this.shadowRoot=root;}
}
const canvas=()=>new RenderCanvas();
globalThis.HTMLElement=Node;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
globalThis.customElements={define:(name,value)=>registry.set(name,value)};
globalThis.document={addEventListener(){},createElement:()=>new Node()};
globalThis.CustomEvent=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
const {DataScroll}=await import('../main.js');
const source=new Blob([Uint8Array.from({length:40000},(_,i)=>i%251)]);
const scroll=new DataScroll(source,100);
scroll.view.isConnected=true;
async function verify(){
 await scroll.view.render();
 let base=0,size=source.size;
 for(let i=0;i<scroll.levels.length;i++){
  const level=scroll.levels[i];
  if(level.bar.source.size!==size||level.offset<0||level.offset+level.length>size||level.base!==base)throw Error('Invalid nested scope');
  const actual=new Uint8Array(await level.bar.source.arrayBuffer());
  for(const index of [0,Math.floor(actual.length/2),actual.length-1])if(actual[index]!==((base+index)%251))throw Error('Bar represents incorrect source bytes');
  base+=level.offset;size=level.length;
 }
 if(scroll.offset!==base||scroll.view.offset!==base||scroll.view.length!==size)throw Error('Visualizer offset mismatch');
 if(scroll.barCount && scroll.view.region==='linear' && scroll.view.length!==scroll.view.resolvedSampleLayout.columns*scroll.view.resolvedSampleLayout.rows)throw Error('Incomplete visualizer grid');
}
if(scroll.barCount!==1)throw Error('Default count not one');
scroll.seek(5000);await verify();
scroll.barCount=3;await verify();
if(scroll.barContainer.children[0]!==scroll.levels[2].bar||scroll.barContainer.children[2]!==scroll.levels[0].bar)throw Error('Bar order reversed');
const [outer,middle,inner]=scroll.levels;
if(!(outer.bar.source.size>middle.bar.source.size&&middle.bar.source.size>inner.bar.source.size))throw Error('Scopes do not narrow');
outer.bar.events.seek({detail:12000});await verify();
middle.bar.events.seek({detail:500});await verify();
inner.bar.events.seek({detail:50});await verify();
const innerSource=inner.bar.source;
inner.bar.events.keydown({key:'ArrowRight',preventDefault(){}});await verify();
if(inner.offset!==51||inner.bar.source!==innerSource)throw Error('Inner keyboard navigation changed parent scope');
inner.bar.events.keydown({key:'ArrowLeft',preventDefault(){}});await verify();
if(inner.offset!==50)throw Error('Inner reverse keyboard navigation failed');
const outerOffset=outer.offset;
scroll.events.wheel({deltaY:1,deltaMode:1,preventDefault(){},composedPath:()=>[outer.bar,scroll]});await verify();
if(outer.offset<=outerOffset)throw Error('Wheel did not move targeted bar');

outer.bar.events['window-change']({detail:{offset:10000,length:900,edge:'bottom'}});await verify();
if(middle.length>900||inner.length>middle.length)throw Error('Descendants not clamped');
const end=inner.offset+inner.length;
inner.bar.events['window-change']({detail:{offset:inner.offset+2,length:inner.length-2,edge:'top'}});await verify();
if(inner.offset+inner.length!==end)throw Error('Inner resize lost anchor');
scroll.seek(Infinity);await verify();
scroll.seek(-Infinity);await verify();
scroll.barCount=1;await verify();
if(scroll.barContainer.children.length!==1)throw Error('Removed bars remain in DOM');
let menu;
Object.defineProperty(scroll.menu,'items',{set(value){menu=value;}});scroll.menu.open=()=>{};
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.bar,scroll]});
if(menu[0].label!=='Bars'||menu[0].input!=='number'||menu[0].value!==1||menu[0].min!==0||!menu.some(item=>item.label==='Points'))throw Error('Shared menu incorrect');
menu[0].action(2);await verify();
scroll.view.region='digraph';await verify();
if(scroll.view.columns!==256||scroll.view.rows!==256||scroll.view.length!==scroll.windowSize)throw Error('Digraph layout changed selection');
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
if(menu.some(item=>item.label==='Cell'||item.label==='Character'))throw Error('Digraph has irrelevant controls');
if(!menu.find(item=>item.label==='Preset').items.some(item=>item.label==='Digraph'&&item.checked))throw Error('Digraph missing from menu');
scroll.view.region='dft';await verify();
if(scroll.view.columns!==513||scroll.view.length!==scroll.windowSize)throw Error('DFT layout changed selection');
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
if(!menu.find(item=>item.label==='Preset').items.some(item=>item.label==='DFT'&&item.checked))throw Error('DFT missing from menu');
if(menu.some(item=>item.label==='Cell'||item.label==='Character'))throw Error('DFT has irrelevant controls');
scroll.view.region='trigraph';await verify();
const previousOffset=scroll.offset;
const cachedCounts=scroll.view.renderer.cache.trigraph.counts;
scroll.view.events.pointerdown({button:0,pointerId:1,clientX:100,clientY:100,preventDefault(){}});
const animationFrames=new Map();let nextFrame=0;
globalThis.requestAnimationFrame=callback=>{animationFrames.set(++nextFrame,callback);return nextFrame;};
globalThis.cancelAnimationFrame=id=>animationFrames.delete(id);
const renderVersion=scroll.view.renderer.version;
for(const x of [120,130,140])scroll.view.events.pointermove({pointerId:1,clientX:x,clientY:80});
if(animationFrames.size!==1||scroll.view.renderer.version!==renderVersion)throw Error('Pointer moves were not coalesced to one animation frame');
const [frameId,renderFrame]=animationFrames.entries().next().value;
animationFrames.delete(frameId);renderFrame();await verify();
if(Math.abs(scroll.view.rotation.yaw+0.2)>1e-9||scroll.offset!==previousOffset)throw Error('Dragging does not rotate cube independently of selection');
if(scroll.view.renderer.cache.trigraph.counts!==cachedCounts)throw Error('Rotation rebuilt histogram');
scroll.view.events.pointerup({pointerId:1});
if(scroll.view.rotationDrag||scroll.view.style.cursor!=='grab')throw Error('Rotation did not end');
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
if(menu[0].label!=='Bars'||menu[1].label!=='Preset'||menu.some(item=>item.label==='Cell'||item.label==='Character'))throw Error('Trigraph menu ordering/visibility incorrect');
const opacityOption=menu.find(item=>item.label==='Points').items.find(item=>item.label==='Opacity');
opacityOption.action('count');await verify();
if(scroll.view.appearance.opacity!=='count'||scroll.view.renderer.latest.appearance.opacity!=='count')throw Error('Opacity mapping not passed to renderer');
menu.find(item=>item.label==='Points').items.find(item=>item.label==='Reset').action();await verify();
menu.find(item=>item.label==='Space').action('cylinder');await verify();
if(scroll.view.pointConfiguration.space!=='cylinder'||menu.find(item=>item.label==='Position').items[0].label!=='Radius')throw Error('Space menu did not refresh');
menu.find(item=>item.label==='Position').items[0].items[0].action('byte3');await verify();
if(scroll.view.pointConfiguration.position[0]!=='byte3'||scroll.view.renderer.latest.configuration.position[0]!=='byte3')throw Error('Position mapping not passed to renderer');
if(scroll.view.renderer.cache.trigraph.counts!==cachedCounts)throw Error('Space change rebuilt histogram');
menu.find(item=>item.label==='Camera').items.find(item=>item.label==='Reset Rotation').action();await verify();
if(scroll.view.rotation.yaw!==-0.6||scroll.view.rotation.pitch!==0.45)throw Error('Reset Rotation failed');
scroll.view.scheduleRotationRender();
scroll.view.region='linear';await verify();
if(animationFrames.size)throw Error('Changing mode retained a scheduled rotation frame');
delete globalThis.requestAnimationFrame;delete globalThis.cancelAnimationFrame;
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
if(menu[1].label!=='Preset'||!menu.some(item=>item.label==='Space')||!menu.some(item=>item.label==='Position')||!menu.some(item=>item.label==='Points')||menu.some(item=>item.label==='Character'))throw Error('Grid menu ordering/visibility incorrect');
scroll.view.shaders=['character'];
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
if(!menu.some(item=>item.label==='Character'))throw Error('Character controls missing when relevant');
scroll.view.region='trigraph';scroll.view.coordinateSystem='cylindrical';scroll.view.axes=[2,1,0];
scroll.view.region='linear';scroll.view.coordinateSystem='radial';scroll.view.setAxis(0,1);await verify();
if(String(scroll.view.axes)!=='1,0')throw Error('2D axis swap failed');
scroll.view.region='trigraph';await verify();
if(scroll.view.coordinateSystem!=='cylindrical'||String(scroll.view.axes)!=='2,1,0')throw Error('3D coordinate preferences not preserved');
scroll.view.region='linear';await verify();
if(scroll.view.coordinateSystem!=='radial'||String(scroll.view.axes)!=='1,0')throw Error('2D coordinate preferences not preserved');
scroll.view.coordinateSystem='cartesian';scroll.view.axes=[0,1];

scroll.view.shaders=['entropy','brightness'];await verify();

scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
if(!menu.some(item=>item.label==='Points')||!menu.some(item=>item.label==='Bars'))throw Error('View menu missing bar count');
menu[0].action(0);await verify();
if(scroll.barContainer.children.length||scroll.view.offset!==0||scroll.view.length!==source.size)throw Error('Zero bars did not show full buffer');
scroll.seek(1000);await verify();
if(scroll.view.offset!==0||scroll.view.length!==source.size)throw Error('Navigation narrowed zero-bar view');
scroll.view.clientWidth=173;await scroll.view.render();await verify();
if(scroll.view.length!==source.size)throw Error('Resize narrowed zero-bar view');
scroll.barCount=2;await verify();
if(scroll.view.length===source.size)throw Error('Bars did not restore selection');
scroll.barCount=0;await verify();
scroll.view.region='hilbert';await verify();
if(scroll.view.length!==source.size||scroll.view.offset!==0)throw Error('Hilbert narrowed zero-bar buffer');
scroll.view.region='linear';await verify();
for(const invalid of [-1,1.5,NaN]){let rejected=false;try{scroll.barCount=invalid;}catch{rejected=true;}if(!rejected)throw Error('Invalid bar count accepted');}
// Raw geometry must preserve nested selection and use sample columns for navigation.
scroll.barCount=1;scroll.view.applyPreset('linear');await verify();
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
menu.find(item=>item.label==='Space').action('cube');await verify();
if(!scroll.view.spatial||'group' in scroll.view.pointConfiguration)throw Error('Bytes cannot use a cube');
const beforeArrow=scroll.offset,step=scroll.view.navigationColumns;
scroll.view.events.keydown({key:'ArrowDown',preventDefault(){}});await verify();
if(scroll.offset!==beforeArrow+step)throw Error('Raw geometry navigation used raster width');
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
const available=menu.find(item=>item.label==='Points').items[0].items[0].items.map(item=>item.label);
if(String(available)!==String(menu.find(item=>item.label==='Position').items[0].items[0].items[0].items.map(item=>item.label)))throw Error('Position and appearance factor pools differ');
if(menu.some(item=>item.label==='Data'))throw Error('Data grouping selector remains');
menu.find(item=>item.label==='Points').items.find(item=>item.label==='Hue').action('phase');await verify();
if(scroll.view.appearance.hue!=='phase')throw Error('Spectral appearance factor unavailable');
menu.find(item=>item.label==='Space').action('square');await verify();
if(scroll.view.spatial||scroll.view.appearance.hue!=='phase')throw Error('Triples cannot use a square');
menu.find(item=>item.label==='Preset').items.find(item=>item.label==='Linear').action();await verify();
if(scroll.view._pointConfiguration||scroll.view.appearance||scroll.view.region!=='linear')throw Error('Preset did not restore profile defaults');
const pipeline={op:'normalize',input:{op:'byte',offset:{op:'add',a:{op:'offset'},b:{op:'constant',value:1}}},min:0,max:255};
scroll.view.setFactor('Neighbor',pipeline);
scroll.events.contextmenu({preventDefault(){},composedPath:()=>[scroll.view,scroll]});
menu.find(item=>item.label==='Points').items.find(item=>item.label==='Hue').items.find(item=>item.label==='Source').items.find(item=>item.label==='Neighbor').action();await verify();
if(scroll.view.appearance.hue.op!=='ref'||scroll.view.renderer.latest.configuration.recipes.Neighbor.op!=='normalize')throw Error('Named recipe did not reach renderer');
const cachedRecipe=scroll.view.renderer.cache.preparedPoints;
scroll.view.setFactor('Neighbor',{op:'invert',input:pipeline});await verify();
if(scroll.view.renderer.cache.preparedPoints===cachedRecipe)throw Error('Editing a named recipe reused stale points');
let cycleRejected=false;try{scroll.view.setFactor('Neighbor',{op:'ref',name:'Neighbor'});}catch{cycleRejected=true;}
if(!cycleRejected)throw Error('Named recipe cycle accepted');
scroll.view.applyPreset('linear');await verify();
if(!scroll.view.pointConfiguration.recipes.Neighbor||scroll.view._pointConfiguration)throw Error('Preset lost custom factor definitions');
scroll.barCount=0;await verify();

scroll.source=new Blob([new Uint8Array(1031)]);
await scroll.view.render();
if(scroll.view.length!==1031||scroll.view.offset!==0)throw Error('New source not fully displayed without bars');
scroll.source=new Blob();
if(scroll.view.length!==0||scroll.levels.some(level=>level.length!==0||level.offset!==0))throw Error('Empty source failed');
console.log('Nested bar checks pass: default count, visual order, narrowing scopes, exact source bytes, movement, resizing, anchored edge, clamping, add/remove, shared menu, zero-bar full buffer, resize, invalid counts, empty source.');
