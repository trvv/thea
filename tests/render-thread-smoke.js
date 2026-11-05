import { hilbert3DCoordinate } from '../recipes.js';
import { spaces, presetConfiguration } from '../point-configuration.js';
import assert from 'node:assert/strict';
import { RenderEngine } from '../render-engine.js';
import { executeRender } from '../rendering.js';
import { defaultAppearance } from '../appearance.js';
import { RenderCanvas } from './render-canvas.js';

const job = {
	kind: 'view', source: new Blob([Uint8Array.from({ length: 262144 }, (_, i) => i % 251)]),
	offset: 0, length: 262144, columns: 512, rows: 512, region: 'hilbert',
	shaders: ['entropy', 'brightness'], width: 800, height: 600, scale: 1,
	encoding: 'ascii', blankSpaces: false, blankNulls: true
};
const canvas = new RenderCanvas();
let closed = false;
const engine = new RenderEngine(canvas, { workerFactory: () => {
	const worker = new Worker(new URL('./render-thread.js', import.meta.url), { type: 'module' });
	worker.addEventListener('message', ({ data }) => {
		if (data.bitmap) data.bitmap.close = () => { closed = true; };
	});
	return worker;
} });
let ticks = 0;
const heartbeat = setInterval(() => ticks++, 1);
const deadline = setTimeout(() => { engine.cancel(); throw new Error('Worker did not finish'); }, 10000);
try {
	assert.equal(await engine.render(job), true);
	assert(ticks > 0, 'Main thread did not process events while worker rendered');
	assert(closed, 'Returned bitmap was not released');
 const inspected=await engine.inspect(256,256);
 assert(inspected?.point.population==='bytes'&&inspected.nodes.length,'Real worker inspection did not return source traits');
	const expected = new RenderCanvas();
	await executeRender(expected, job);
	assert.deepEqual(canvas.pixels, expected.pixels);
	for (const region of ['digraph', 'dft', 'trigraph']) {
		const spec = { ...job, region, columns: region === 'dft' ? 513 : 256, rows: 256 };
		assert.equal(await engine.render(spec), true);
		await executeRender(expected, spec);
		assert.deepEqual(canvas.pixels, expected.pixels);
	}
	const cube = { ...job, region: 'trigraph', columns: 256, rows: 256, rotation: { yaw: 1, pitch: -0.4 } };
	assert.equal(await engine.render(cube), true);
	await executeRender(expected, cube);
	assert.deepEqual(canvas.pixels, expected.pixels);
	for (const settings of [
		{region:'trigraph',coordinateSystem:'cylindrical',axes:[2,1,0],frequencyOpacity:true},
		{region:'trigraph',coordinateSystem:'spherical',axes:[1,0,2],frequencyOpacity:false},
		{region:'digraph',coordinateSystem:'radial',axes:[1,0]}
	]) {
		const spec={...job,...settings,columns:256,rows:256};
		assert.equal(await engine.render(spec),true);await executeRender(expected,spec);
		assert.deepEqual(canvas.pixels,expected.pixels);
	}
	for (const region of ['linear','hilbert','digraph','dft','trigraph']) {
		const appearance={...defaultAppearance(region), hue:region==='trigraph'||region==='digraph'?'byte1':region==='dft'?'phase':'position'};
		const spec={...job,region,appearance,length:4096,columns:64,rows:64};
		assert.equal(await engine.render(spec),true); await executeRender(expected,spec);
		assert.deepEqual(canvas.pixels,expected.pixels,`${region} appearance worker mismatch`);
	}
	for (const region of ['linear','hilbert','digraph','trigraph','dft']) for (const space of Object.keys(spaces)) {
		const configuration={...presetConfiguration(region),space};
		const spec={...job,region,configuration,length:512,columns:64,rows:48,sampleLayout:{columns:32,rows:16},appearance:defaultAppearance(region)};
		assert.equal(await engine.render(spec),true);await executeRender(expected,spec);
		assert.deepEqual(canvas.pixels,expected.pixels,`${region}/${space} worker mismatch`);
	}
	for (const space of Object.keys(spaces)) {
		const configuration={...presetConfiguration('linear'),space,position:['value','byte2','entropy']};
		const appearance={...defaultAppearance('linear'),hue:'phase',lightness:'amplitude',opacity:'pairCount',size:'byte3'};
		const spec={...job,configuration,appearance,length:512,columns:64,rows:48,sampleLayout:{columns:32,rows:16}};
		assert.equal(await engine.render(spec),true); await executeRender(expected,spec);
		assert.deepEqual(canvas.pixels,expected.pixels,`Mixed factors ${space} worker mismatch`);
	}
	const neighbor={op:'normalize',min:0,max:255,input:{op:'byte',offset:{op:'add',a:{op:'offset'},b:{op:'constant',value:1}}}};
	for(const space of Object.keys(spaces)) {
		const coordinate=component=>({op:'component',component,input:{op:'hilbert',input:'position',order:5}});
		const configuration={...presetConfiguration('linear'),space,position:[coordinate(0),coordinate(1),'position'],recipes:{neighbor}};
		const appearance={...defaultAppearance('linear'),hue:{op:'entropy',offset:{op:'offset'},window:64},lightness:{op:'ref',name:'neighbor'},opacity:{op:'invert',input:{op:'ref',name:'neighbor'}}};
		const spec={...job,configuration,appearance,length:1024,columns:64,rows:48,sampleLayout:{columns:32,rows:32}};
		assert.equal(await engine.render(spec),true);await executeRender(expected,spec);
		assert.deepEqual(canvas.pixels,expected.pixels,`Recipe ${space} worker mismatch`);
	}
 for(const population of ['bytes','bins','triples']) {
  const configuration={...presetConfiguration('linear'),space:'cube',footprint:'point',population,position:[0,1,2].map(axis=>hilbert3DCoordinate(axis))};
  const spec={...job,region:'linear',configuration,length:512,columns:64,rows:48,sampleLayout:{columns:32,rows:16},appearance:{...defaultAppearance('linear'),hue:'phase'}};
  assert.equal(await engine.render(spec),true);await executeRender(expected,spec);
  assert.deepEqual(canvas.pixels,expected.pixels,`3D Hilbert ${population} worker mismatch`);
 }
 for(const population of ['bytes','bins','triples'])for(const mode of ['scale','truncate']) {
  const configuration={...presetConfiguration('linear'),space:'cube',population,position:['column','row','slice'],footprint:'grid',
   dimensions:{width:{start:0,end:4,step:1,fit:true,mode},height:{start:0,end:3,step:1,fit:true,mode},depth:{start:0,end:6,step:1,fit:true,mode}}};
  const spec={...job,region:'linear',configuration,length:64,columns:64,rows:48,sampleLayout:{columns:8,rows:8},appearance:{...defaultAppearance('linear'),hue:'slice'}};
  assert.equal(await engine.render(spec),true);await executeRender(expected,spec);
  assert.deepEqual(canvas.pixels,expected.pixels,`${population}/${mode} range worker mismatch`);
 }
 const hilbertPreset={...job,region:'hilbert3d',configuration:presetConfiguration('hilbert3d'),shaders:['brightness'],length:64,columns:64,rows:48,sampleLayout:{columns:8,rows:8}};
 assert.equal(await engine.render(hilbertPreset),true);await executeRender(expected,hilbertPreset);
 assert.deepEqual(canvas.pixels,expected.pixels,'Hilbert 3D preset worker mismatch');
	const prime = { ...job, region: 'dft', length: 65537, columns: 513, rows: 129 };
	assert.equal(await engine.render(prime), true);
	await executeRender(expected, prime);
	assert.deepEqual(canvas.pixels, expected.pixels);
	console.log(`Real worker check passes: matching pixels; UI thread processed ${ticks} timer events during rendering.`);
} finally {
	clearInterval(heartbeat);
	clearTimeout(deadline);
	engine.cancel();
}
