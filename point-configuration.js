/**
 * Geometry and mapping validation. A raw configuration describes where factors go; it does not
 * restrict which analyses may be mixed on each point population.
 * @module point-configuration
 */
import { validateRecipe, validateDefinitions } from './recipes.js';
import { factorIndices, factorOptions } from './factors.js';
import { populations, defaultSampleLimit } from './populations.js';

import { spaces } from './spaces.js';
export { spaces } from './spaces.js';
export { factorIndices } from './factors.js';

/**
 * Offer the same primitive sources for position and appearance; recipes supply combinations without
 * adding more source enums.
 */
export function configurationFactors() { return factorOptions; }
/**
 * Represent preset intent as raw mappings while preserving the separate optimized implementation
 * for unchanged presets.
 */
export function presetConfiguration(region) {
 if(!['linear','hilbert','digraph','dft','trigraph'].includes(region))throw new TypeError('Unknown preset');
 return {population:region==='digraph'?'pairs':region==='trigraph'?'triples':region==='dft'?'bins':'bytes',
  backend:'cpu',footprint:region==='linear'||region==='hilbert'?'grid':'point',sampleLimit:defaultSampleLimit,layout:region==='hilbert'?'hilbert':'linear', space:region==='trigraph'?'cube':'square',
  position:region==='linear'||region==='hilbert'?['column','row','none']:region==='dft'?['phase','frequency','none']:['value','byte2',region==='trigraph'?'byte3':'none'],
  inverted:region==='dft'?[false,true,false]:[false,false,false]};
}

/**
 * Reject cycles, invalid spaces, and nonscalar mappings before replacing live state. Preserve all
 * three mappings even when a 2D space temporarily hides Z.
 */
export function validateConfiguration(configuration) {
 const {layout,space,position,inverted}=configuration;
 const recipes=validateDefinitions(configuration.recipes);
 const population=configuration.population??'bytes';
 const backend=configuration.backend??'cpu';
 if(!['cpu','webgl'].includes(backend))throw new TypeError('Unknown point backend');
 const footprint=configuration.footprint??(position?.some(value=>value==='column'||value==='row'||value?.op==='factor'&&['column','row'].includes(value.name))?'grid':'point');
 const sampleLimit=configuration.sampleLimit===undefined?defaultSampleLimit:configuration.sampleLimit;
 if(!populations.includes(population))throw new TypeError('Unknown point population');
 if(!['grid','point'].includes(footprint))throw new TypeError('Unknown point footprint');
 if(sampleLimit!==null&&(!Number.isSafeInteger(sampleLimit)||sampleLimit<1||sampleLimit>16777216))throw new TypeError('Sample limit must be 1–16777216 or null');
 if(!Object.hasOwn(spaces,space)||!['linear','hilbert'].includes(layout))throw new TypeError('Unknown point configuration');
  if(!Array.isArray(position)||position.length!==3)throw new TypeError('Expected three position channels');
 const mapped=position.map(value=>value==='none'?'none':validateRecipe(value,recipes));
 if(!Array.isArray(inverted)||inverted.length!==3||inverted.some(value=>typeof value!=='boolean'))throw new TypeError('Invalid position direction');
 return {backend,population,footprint,sampleLimit,layout,space,position:mapped,inverted:[...inverted],recipes};
}
// Resolve factor choices once per configuration, outside the point loop.
/**
 * Resolve scalar slots once and transform them in a normalized space. Internal numeric slots come
 * from recipe compilation; legacy string slots use the canonical catalog.
 */
export function compilePosition(configuration) {
 const indices=configuration.position.map(factor=>factor==='none'?-1:typeof factor==='number'?factor:factorIndices[factor]);
 const {space,inverted}=configuration;
 return (values,out)=>{
  let a=indices[0]<0?0.5:values[indices[0]],b=indices[1]<0?0.5:values[indices[1]],c=indices[2]<0?0.5:values[indices[2]];
  if(inverted[0])a=1-a;if(inverted[1])b=1-b;if(inverted[2])c=1-c;
  if(space==='circle'){out[0]=a*Math.cos(b*Math.PI*2);out[1]=-a*Math.sin(b*Math.PI*2);out[2]=0;}
  else if(space==='cylinder'){out[0]=a*Math.cos(b*Math.PI*2);out[1]=c*2-1;out[2]=a*Math.sin(b*Math.PI*2);}
  else if(space==='sphere'){out[0]=a*Math.sin(c*Math.PI)*Math.cos(b*Math.PI*2);out[1]=a*Math.cos(c*Math.PI);out[2]=a*Math.sin(c*Math.PI)*Math.sin(b*Math.PI*2);}
  else {out[0]=a*2-1;out[1]=b*2-1;out[2]=space==='cube'?c*2-1:0;}
  return out;
 };
}
