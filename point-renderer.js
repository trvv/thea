/**
 * General point path with CPU providers and CPU/WebGL rasterization. Prepared geometry and colors survive camera/quality changes;
 * rasterization still runs for each presented frame.
 * @module point-renderer
 */
import { compileRecipes, recipeRoots } from './recipes.js';
import { appearanceChannels } from './factor-catalog.js';
import { compileAppearance, defaultAppearance } from './appearance.js';
import { compilePosition, spaces } from './point-configuration.js';
import { projectedPointSize } from './trigraph.js';
import { paintWebGL } from './point-webgl.js';
import { preparationKey } from './render-identity.js';
import { pointFactors } from './point-factors.js';

// Requested providers yield normalized factors for position and appearance. Prepared points survive camera changes in either renderer thread.
/**
 * Evaluate reachable recipes while preparing points, then keep those points across camera and
 * raster-scale changes. Colored transparency requires depth ordering rather than the native
 * white-opacity shortcut.
 * @returns {Promise<object|null>} Frame metrics, or null after supersession; does not remap the
 *   completed image.
 */
export async function renderPoints(canvas, job, cache, current, helpers) {
 const config=job.configuration, region=job.region;
 const appearance=job.appearance||defaultAppearance(region,job.shaders,job.frequencyOpacity);
 const signature=job.preparationKey ?? preparationKey(job);
 let prepared=cache.preparedPoints;
 const started=performance.now();
 if(!prepared||prepared.source!==(job.sourceId??job.source)||prepared.signature!==signature){
  const program=compileRecipes(recipeRoots(config,appearance),config.recipes);
  const evaluate=program.createEvaluator();
  const mapped={shape:appearance.shape};
  for(const channel of appearanceChannels)mapped[channel]=program.bindings[channel]??'none';
  const style=compileAppearance('compiled',mapped), position=compilePosition({...config,position:[0,1,2].map(i=>program.bindings[`p${i}`]??'none')});
  const xyz=new Float64Array(3), color=new Uint8ClampedArray(4);
  let size=0,capacity=0,positions,colors,sizes,labels=[];
  const text=job.shaders.includes('hex')||job.shaders.includes('character');
  /** Evaluate into synthetic slots before geometry/color conversion. Copy prepared values now because the provider reuses its input vector for the next sample. */
  const emit=(factors,label,context)=>{
   evaluate(factors,context);
   if(size===capacity){
    capacity=Math.max(256,capacity*2);
    const p=new Float32Array(capacity*3),c=new Uint8ClampedArray(capacity*4),s=new Float32Array(capacity);
    if(positions){p.set(positions);c.set(colors);s.set(sizes);}positions=p;colors=c;sizes=s;
   }
   position(factors,xyz);positions.set(xyz,size*3);style.rgba(factors,color);colors.set(color,size*4);sizes[size]=style.size(factors);
   if(text)labels.push(label);size++;
  };
  const visit = await pointFactors(job, appearance, cache, current, helpers, program);
  if (!visit || !current()) return null;
  visit(emit);
  prepared=cache.preparedPoints={source:job.sourceId??job.source,signature,positions,colors,sizes,labels,size,grid:visit.grid,shape:style.shape,text};
 }
 if(!current())return null;
 const {columns:width,rows:height}=job;
 if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
 const context=canvas.getContext('2d');
 let scratch=cache.pointRaster;
 if(!scratch)scratch=cache.pointRaster={};
 if(scratch.width!==width||scratch.height!==height){scratch.width=width;scratch.height=height;scratch.image=null;}
 const spatial=spaces[config.space].length===3;
 const {yaw,pitch}=job.rotation||{yaw:-0.6,pitch:0.45};
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 if(!scratch.projected||scratch.projected.length<prepared.size*4) {
  scratch.projected=new Float32Array(prepared.size*4);
  scratch.order=new Uint32Array(prepared.size);
 }
 const projected=scratch.projected;
 const focal=Math.max(0,Math.min(width-1,height-1))*0.8;
 const grid=config.footprint ? config.footprint==='grid' : config.position.some(factor=>factor==='column'||factor==='row'||factor?.op==='factor'&&['column','row'].includes(factor.name));
 const cellWidth=grid?width/prepared.grid.columns:Math.max(1,job.pointScale||1)*1.5;
 const cellHeight=grid?height/prepared.grid.rows:cellWidth;
 for(let i=0;i<prepared.size;i++){
  const p=i*3,q=i*4,x=prepared.positions[p],y=prepared.positions[p+1],z=prepared.positions[p+2];
  if(spatial){
   const rx=x*cy+z*sy,rz=z*cy-x*sy,ry=y*cp-rz*sp,depth=y*sp+rz*cp;
   projected[q]=(width-1)/2+rx*focal/(3.5-depth);projected[q+1]=(height-1)/2-ry*focal/(3.5-depth);projected[q+2]=depth;
   projected[q+3]=(grid?2*focal/((3.5-depth)*Math.max(prepared.grid.columns,prepared.grid.rows,prepared.grid.slices)):projectedPointSize(depth)*(job.pointScale||1))*prepared.sizes[i]/2;
  }else{
   const circle=config.space==='circle',scale=circle?Math.min(width,height)/2:0;
   projected[q]=circle?width/2+x*scale:(x+1)*width/2;
   projected[q+1]=circle?height/2+y*scale:(y+1)*height/2;
   projected[q+3]=prepared.sizes[i];
  }
 }
 const order=spatial?scratch.order.subarray(0,prepared.size):null;
 if(order){for(let i=0;i<order.length;i++)order[i]=i;order.sort((a,b)=>projected[a*4+2]-projected[b*4+2]);}
 const accelerated=config.backend==='webgl'&&paintWebGL(cache,context,prepared,projected,order,{width,height,spatial,cellWidth,cellHeight});
 cache.pointBackend=accelerated?'webgl':'cpu';
 if(!accelerated){
  const image=scratch.image ||= context.createImageData(width,height),pixels=image.data;
  pixels.fill(0);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  for(let n=0;n<prepared.size;n++){
   const i=order?order[n]:n,q=i*4,x=projected[q],y=projected[q+1];
   const halfX=spatial?projected[q+3]:cellWidth*projected[q+3]/2,halfY=spatial?halfX:cellHeight*projected[q+3]/2;
   const alpha=prepared.colors[q+3]/255;if(!alpha)continue;
   if(!(halfX>0&&halfY>0))continue;
   const left=Math.max(0,Math.floor(x-halfX)),right=Math.min(width-1,Math.ceil(x+halfX));
   const top=Math.max(0,Math.floor(y-halfY)),bottom=Math.min(height-1,Math.ceil(y+halfY));
   for(let py=top;py<=bottom;py++)for(let px=left;px<=right;px++){
    let coverage=0;
    for(let probe=0;probe<4;probe++){
     const nx=(px+(probe&1?0.75:0.25)-x)/halfX,ny=(py+(probe&2?0.75:0.25)-y)/halfY;
     if(prepared.shape==='circle'?nx*nx+ny*ny<=1:Math.abs(nx)<=1&&Math.abs(ny)<=1)coverage++;
    }
    const a=alpha*coverage/4,p=(py*width+px)*4;
    for(let c=0;c<3;c++)pixels[p+c]=Math.round(prepared.colors[q+c]*a+pixels[p+c]*(1-a));
   }
  }
  context.putImageData(image,0,0);
 }
 if(prepared.text){
  context.textAlign='center';context.textBaseline='middle';
  for(let n=0;n<prepared.size;n++){
   const i=order?order[n]:n,q=i*4,size=spatial?projected[q+3]*2:Math.min(cellWidth,cellHeight)*prepared.sizes[i];
   context.font=`${size*0.75/(job.shaders.includes('hex')?1.2:1)}px monospace`;
   context.fillStyle=prepared.colors[q]*0.299+prepared.colors[q+1]*0.587+prepared.colors[q+2]*0.114>128?'black':'white';
   context.fillText(prepared.labels[i],projected[q],projected[q+1]);
  }
 }
 return {duration:performance.now()-started};
}
