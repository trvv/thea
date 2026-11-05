/** Versioned, source-independent visualization profiles. JSON is the storage format. */
import { validateConfiguration, presetConfiguration } from './point-configuration.js';
import { validateDefinitions } from './recipes.js';
import { needsPointFactors } from './factors.js';
import { validateAppearance } from './appearance.js';

export function validateProfile(value) {
 if (!value || ![1,2].includes(value.version)) throw new TypeError('Unsupported visualization profile version');
 const { region } = value;
 presetConfiguration(region);
 const recipes = validateDefinitions(value.recipes);
 let raw=value.configuration;
 // v1 Layout only generated coordinates. Preserve custom positional mappings
 // instead of silently replacing them with a new arrangement on import.
 if(raw&&value.version===1) {
  const gridMapped=JSON.stringify(raw.position)===JSON.stringify(['column','row','none']);
  raw={...raw,layout:gridMapped?raw.layout:'mapped',sampling:raw.layout==='hilbert'?'representative':'average'};
 }
 let configuration = raw == null ? undefined : validateConfiguration({...raw,recipes});
 const appearance = value.appearance == null ? undefined : validateAppearance(region,value.appearance,recipes);
 if (!Array.isArray(value.shaders) || value.shaders.some(flag=>!['entropy','brightness','character','hex'].includes(flag))
  || value.shaders.includes('character')&&value.shaders.includes('hex')) throw new TypeError('Invalid profile text/color flags');
 if(!configuration && (appearance && needsPointFactors(region,appearance) || !['linear','hilbert'].includes(region) && value.shaders.some(flag=>flag==='hex'||flag==='character'))) configuration=validateConfiguration({...presetConfiguration(region),recipes});
 const allowed = region==='trigraph'?['cartesian','cylindrical','spherical']:['cartesian','radial'];
 if (!allowed.includes(value.coordinateSystem)) throw new TypeError('Invalid profile coordinates');
 const dimensions=region==='trigraph'?3:2;
 if (!Array.isArray(value.axes)||value.axes.length!==dimensions||new Set(value.axes).size!==dimensions||value.axes.some(axis=>!Number.isInteger(axis)||axis<0||axis>=dimensions)) throw new TypeError('Invalid profile axes');
 if (!value.rotation || !Number.isFinite(value.rotation.yaw)||!Number.isFinite(value.rotation.pitch)||Math.abs(value.rotation.pitch)>Math.PI/2) throw new TypeError('Invalid profile camera');
 if (!['ascii','ascii-overbar','latin1','cp437'].includes(value.encoding)) throw new TypeError('Invalid profile encoding');
 for (const key of ['blankSpaces','blankNulls','frequencyOpacity']) if (typeof value[key]!=='boolean') throw new TypeError(`Invalid profile ${key}`);
 return structuredClone({version:2,region,recipes,configuration,appearance,shaders:[...new Set(value.shaders)],
  coordinateSystem:value.coordinateSystem,axes:value.axes,rotation:value.rotation,encoding:value.encoding,
  blankSpaces:value.blankSpaces,blankNulls:value.blankNulls,frequencyOpacity:value.frequencyOpacity});
}

export const serializeProfile = profile => JSON.stringify(validateProfile(profile));
export const parseProfile = json => validateProfile(JSON.parse(json));
