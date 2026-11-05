/**
 * Appearance compilation bridges two factor layouts: compact preset tuples and canonical recipe
 * slots. Do not use their numeric indices interchangeably.
 * @module appearance
 * @see docs/recipes.md
 */
import { validateRecipe } from './recipes.js';
import { appearanceChannels as channels, factorIndices, factorOptions } from './factors.js';
export { factorIndices } from './factors.js';
/**
 * Keep the compatibility accessor on the same catalog as position recipes; menu labels must not
 * introduce separate factor semantics.
 */
export function appearanceFactors() { return factorOptions; }
/**
 * Translate preset defaults into mappings without forcing callers to allocate an explicit override
 * for unchanged settings.
 */
export function defaultAppearance(region, shaders = ['entropy','brightness'], frequencyOpacity = false) {
 const mapping={hue:shaders.includes('entropy')?'entropy':'none',saturation:'none',lightness:'none',opacity:'none',size:'none',shape:'square'};
 if(['linear','hilbert','hilbert3d'].includes(region)){
  const hue=shaders.includes('entropy')&&shaders.includes('brightness');
  mapping.hue=hue?'entropy':'none';mapping.lightness=shaders.includes('brightness')?'value':shaders.includes('entropy')?'entropy':'none';
 }else if(region==='dft')mapping.lightness='amplitude';
 else if(frequencyOpacity&&region==='trigraph')mapping.opacity='tripleCount';
 else mapping.lightness=region==='trigraph'?'tripleCount':'pairCount';
 return mapping;
}
/**
 * Validate every channel against named definitions before state changes; clone expressions so a
 * subsequent caller mutation cannot bypass that boundary.
 */
export function validateAppearance(region, mapping, definitions = {}) {
 if(!mapping||!['square','circle'].includes(mapping.shape))throw new TypeError('Invalid appearance mapping');
 const copy={shape:mapping.shape};
 for(const channel of channels)copy[channel]=mapping[channel]==='none'?'none':validateRecipe(mapping[channel],definitions);
 return copy;
}

/**
 * Map unbounded counts to a bounded opacity-compatible factor without a frame-dependent peak that
 * would make identical counts change meaning.
 */
export const occurrenceFactor = count => 1 - Math.exp(-0.25 * Math.log1p(count));
/**
 * Fill the compact native trigraph tuple layout. Its slots differ from canonical factorIndices;
 * only the native appearance compiler should consume it.
 */
export function tupleFactors(key,count,out) {
 out[0]=(key>>>16)/255;out[1]=((key>>>8)&255)/255;out[2]=(key&255)/255;out[3]=occurrenceFactor(count);
 return out;
}
const compiled=new Map();
/**
 * Resolve channel slots once, retaining integer byte/entropy palettes where possible. The internal
 * compiled mode receives numeric recipe-output slots, not expressions.
 */
export function compileAppearance(region,mapping) {
 const key=JSON.stringify([region,...channels.map(channel=>mapping[channel]),mapping.shape]);
 if(compiled.has(key)){const value=compiled.get(key);compiled.delete(key);compiled.set(key,value);return value;}
 if(region!=='compiled')validateAppearance(region,mapping);
 const indices=region==='points'?factorIndices:{value:0,entropy:1,position:2,byte1:0,byte2:1,byte3:2,count:3,phase:0,frequency:1,amplitude:2,column:4,row:5,pairCount:3,tripleCount:3};
 const [h,s,l,a,z]=channels.map(channel=>mapping[channel]==='none'?-1:region==='compiled'?mapping[channel]:indices[mapping[channel]]);
 const hasColor=h>=0||s>=0;
 const rgba=(values,out,offset=0)=>{
  const hue=h<0?0:values[h]*300;
  const saturation=s<0?(h<0?0:0.75):values[s];
  const lightness=l<0?(hasColor?0.5:1):(hasColor?0.15+0.70*values[l]:values[l]);
  const amplitude=saturation*Math.min(lightness,1-lightness);
  for(let channel=0;channel<3;channel++){
   const k=([0,8,4][channel]+hue/30)%12;
   out[offset+channel]=Math.round(255*(lightness-amplitude*Math.max(-1,Math.min(k-3,9-k,1))));
  }
  out[offset+3]=a<0?255:Math.round(255*values[a]);
 };
 const result={ key, rgba, size:values=>z<0?1:0.5+1.5*values[z], shape:mapping.shape,
  needsEntropy:channels.some(channel=>mapping[channel]==='entropy'),
  sizeFactor:mapping.size, translucent:a>=0, palette:null };
 if((region==='linear'||region==='hilbert')&&[h,s,l,a].every(index=>index<=1)){
  const bytes=new Uint8ClampedArray(65536*4),values=new Float64Array(4),color=new Uint8ClampedArray(4);
  for(let entropy=0;entropy<256;entropy++)for(let value=0;value<256;value++){
   values[0]=value/255;values[1]=entropy/255;rgba(values,color);
   const offset=(entropy*256+value)*4,alpha=color[3]/255;
   bytes[offset]=Math.round(color[0]*alpha);bytes[offset+1]=Math.round(color[1]*alpha);bytes[offset+2]=Math.round(color[2]*alpha);bytes[offset+3]=255;
  }
  result.palette=new Uint32Array(bytes.buffer);
 }
 compiled.set(key,result);if(compiled.size>16)compiled.delete(compiled.keys().next().value);
 return result;
}

// Shared grid/point painting consumes normalized factor vectors. The mapping
// and any byte/entropy LUT are resolved once, before the sample loop.
/**
 * Use logical-grid ImageData for plain cells, but a display-sized canvas for glyphs and variable
 * marks so they remain legible after stretching.
 */
export function paintAppearanceGrid(canvas,columns,rows,job,visit) {
 const style=compileAppearance(job.region,job.appearance);
 const text=job.shaders?.includes('character')||job.shaders?.includes('hex');
 const marks=style.sizeFactor!=='none'||style.shape==='circle'||text;
 const width=marks?Math.max(1,Math.round(job.width*(job.scale||1))):columns;
 const height=marks?Math.max(1,Math.round(job.height*(job.scale||1))):rows;
 if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
 const context=canvas.getContext('2d'),image=marks?null:context.createImageData(width,height);
 const packed=image?new Uint32Array(image.data.buffer):null;
 if(image)for(let p=3;p<image.data.length;p+=4)image.data[p]=255;
 const color=new Uint8ClampedArray(4),cw=width/columns,ch=height/rows;
 if(marks){context.fillStyle='black';context.fillRect(0,0,width,height);context.textAlign='center';context.textBaseline='middle';}
 visit((cell,values,label)=>{
  if(packed&&style.palette&&Number.isInteger(values[0]*255)&&Number.isInteger(values[1]*255)){packed[cell]=style.palette[Math.round(values[1]*255)*256+Math.round(values[0]*255)];return;}
  style.rgba(values,color);const alpha=color[3]/255;
  if(image){const p=cell*4;image.data[p]=Math.round(color[0]*alpha);image.data[p+1]=Math.round(color[1]*alpha);image.data[p+2]=Math.round(color[2]*alpha);image.data[p+3]=255;return;}
  const size=style.size(values),cx=(cell%columns+0.5)*cw,cy=(Math.floor(cell/columns)+0.5)*ch;
  context.fillStyle=`rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
  if(style.shape==='circle'){context.beginPath();context.ellipse(cx,cy,cw*size/2,ch*size/2,0,0,Math.PI*2);context.fill();}
  else context.fillRect(cx-cw*size/2,cy-ch*size/2,cw*size,ch*size);
  if(label!==undefined){context.fillStyle=(color[0]*0.299+color[1]*0.587+color[2]*0.114)*alpha>128?'black':'white';context.font=`${Math.min(cw/(job.shaders.includes('hex')?1.2:0.6),ch)*0.85*size}px monospace`;context.fillText(label,cx,cy);}
 });
 if(image)context.putImageData(image,0,0);
}
