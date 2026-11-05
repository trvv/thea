/** Versioned, source-independent visualization profiles. JSON is the storage format. */
import { validateConfiguration, presetConfiguration } from './point-configuration.js';
import { validateDefinitions, hilbertCoordinate, hilbert3DCoordinate } from './recipes.js';
import { validateAppearance } from './appearance.js';

export function validateProfile(value) {
 if (!value || ![1,2,3].includes(value.version)) throw new TypeError('Unsupported visualization profile version');
 const { region } = value;
 presetConfiguration(region);
 const recipes = validateDefinitions(value.recipes);
 let raw=value.configuration;
 if(!raw&&value.version<3&&region==='hilbert') {
  raw=presetConfiguration('hilbert');
  if(value.coordinateSystem==='radial')raw.space='circle';
  if(value.axes?.[0]===1)[raw.position[0],raw.position[1]]=[raw.position[1],raw.position[0]];
 }
 // Materialize old arrangement choices as ordinary position mappings, then
 // discard Layout. New profiles have only axis ranges and coordinate recipes.
 if(raw&&value.version<3) {
  const layout=raw.layout;
  const canonicalGrid=JSON.stringify(raw.position)===JSON.stringify(['column','row','none']);
  const arranged=value.version===2||canonicalGrid;
  let position=raw.position;
  if(arranged&&layout==='linear')position=['column','row','slice'];
  if(arranged&&layout==='linear3d')position=['column','row','slice'];
  if(arranged&&layout==='hilbert')position=[hilbertCoordinate(0,{op:'pointIndex'}),hilbertCoordinate(1,{op:'pointIndex'}),'none'];
  if(arranged&&layout==='hilbert3d')position=[0,1,2].map(axis=>hilbert3DCoordinate(axis));
  const dimensions=structuredClone(raw.dimensions||{});
  for(const [name,legacy] of [['width',raw.grid?.columns],['height',raw.grid?.rows]])if(legacy&&!dimensions[name]&&!['hilbert','hilbert3d'].includes(layout)) {
   const radial=raw.space==='circle'||raw.space==='sphere'||raw.space==='cylinder';
   const end=radial?(name==='width'?1:360):legacy;
   dimensions[name]={start:0,end,step:radial?end/legacy:1,fit:true};
  }
  raw={...raw,position,dimensions,sampling:raw.sampling||(layout==='hilbert'?'representative':'average')};
 }
 let configuration = raw == null ? undefined : validateConfiguration({...raw,recipes});
 const appearance = value.appearance == null ? undefined : validateAppearance(region,value.appearance,recipes);
 if (!Array.isArray(value.shaders) || value.shaders.some(flag=>!['entropy','brightness','character','hex'].includes(flag))
  || value.shaders.includes('character')&&value.shaders.includes('hex')) throw new TypeError('Invalid profile text/color flags');

 const allowed = ['trigraph','hilbert3d'].includes(region)?['cartesian','cylindrical','spherical']:['cartesian','radial'];
 if (!allowed.includes(value.coordinateSystem)) throw new TypeError('Invalid profile coordinates');
 const dimensions=['trigraph','hilbert3d'].includes(region)?3:2;
 if (!Array.isArray(value.axes)||value.axes.length!==dimensions||new Set(value.axes).size!==dimensions||value.axes.some(axis=>!Number.isInteger(axis)||axis<0||axis>=dimensions)) throw new TypeError('Invalid profile axes');
 if (!value.rotation || !Number.isFinite(value.rotation.yaw)||!Number.isFinite(value.rotation.pitch)||Math.abs(value.rotation.pitch)>Math.PI/2) throw new TypeError('Invalid profile camera');
 if (!['ascii','ascii-overbar','latin1','cp437'].includes(value.encoding)) throw new TypeError('Invalid profile encoding');
 for (const key of ['blankSpaces','blankNulls','frequencyOpacity']) if (typeof value[key]!=='boolean') throw new TypeError(`Invalid profile ${key}`);
 if(!configuration)configuration=validateConfiguration(presetConfiguration(region,{coordinateSystem:value.coordinateSystem,axes:value.axes,recipes}));
 return structuredClone({version:3,region,recipes,configuration,appearance,shaders:[...new Set(value.shaders)],
  coordinateSystem:value.coordinateSystem,axes:value.axes,rotation:value.rotation,encoding:value.encoding,
  blankSpaces:value.blankSpaces,blankNulls:value.blankNulls,frequencyOpacity:value.frequencyOpacity});
}

export const serializeProfile = profile => JSON.stringify(validateProfile(profile));
export const parseProfile = json => validateProfile(JSON.parse(json));
