/**
 * Geometry and mapping validation. A raw configuration describes where factors go; it does not
 * choose a byte-pair or spectrum data domain.
 * @module point-configuration
 */
import { validateRecipe, validateDefinitions } from './recipes.js';
import { factorIndices, factorOptions } from './factors.js';

export const spaces = {
 square: ['X', 'Y'], circle: ['Radius', 'Angle'], cube: ['X', 'Y', 'Z'],
 cylinder: ['Radius', 'Angle', 'Height'], sphere: ['Radius', 'Azimuth', 'Inclination']
};
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
 return {layout:region==='hilbert'?'hilbert':'linear', space:region==='trigraph'?'cube':'square',
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
 if(!Object.hasOwn(spaces,space)||!['linear','hilbert'].includes(layout))throw new TypeError('Unknown point configuration');
  if(!Array.isArray(position)||position.length!==3)throw new TypeError('Expected three position channels');
 const mapped=position.map(value=>value==='none'?'none':validateRecipe(value,recipes));
 if(!Array.isArray(inverted)||inverted.length!==3||inverted.some(value=>typeof value!=='boolean'))throw new TypeError('Invalid position direction');
 return {layout,space,position:mapped,inverted:[...inverted],recipes};
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
