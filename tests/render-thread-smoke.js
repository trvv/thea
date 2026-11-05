import assert from 'node:assert/strict';
import { RenderEngine } from '../render-engine.js';
import { executeRender } from '../rendering.js';
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
