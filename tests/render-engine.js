import assert from 'node:assert/strict';
import { RenderEngine } from '../render-engine.js';
import { executeRender, entropyShading, hilbertCells } from '../rendering.js';
import { RenderCanvas, cellColor } from './render-canvas.js';

class TestWorker {
	messages = [];
	canvas = new RenderCanvas();
	cache = {};
	terminated = false;
	postMessage(message) { this.messages.push(message); }
	terminate() { this.terminated = true; }
	async complete(index, duration) {
		const { id, job } = this.messages[index];
		const result = await executeRender(this.canvas, job, this.cache);
		const bitmap = this.canvas.transferToImageBitmap();
		this.onmessage({ data: { id, bitmap, ...result, duration: duration ?? result.duration } });
		assert(bitmap.closed, 'Bitmaps must be released, including stale frames');
	}
}

const source = new Blob([Uint8Array.from({ length: 131072 }, (_, i) => i % 256)]);
const job = {
	kind: 'view', source, offset: 32, length: 16, columns: 4, rows: 4, region: 'linear',
	shaders: ['entropy', 'brightness'], width: 80, height: 48, scale: 2,
	encoding: 'ascii', blankSpaces: false, blankNulls: true
};

// Worker and local execution must produce identical pixels and character commands.
for (const region of ['linear', 'hilbert', 'digraph', 'dft', 'trigraph']) {
	for (const shaders of [[], ['brightness'], ['entropy'], ['entropy', 'brightness'], ['character'], ['hex'], ['entropy', 'brightness', 'character'], ['entropy', 'brightness', 'hex']]) {
		const spec = { ...job, region, shaders };
		const localCanvas = new RenderCanvas();
		const workerCanvas = new RenderCanvas();
		const worker = new TestWorker();
		const local = new RenderEngine(localCanvas, { budget: Infinity });
		const remote = new RenderEngine(workerCanvas, { budget: 0, workerFactory: () => worker });
		assert.equal(await local.render(spec), true);
		const render = remote.render(spec);
		await worker.complete(0);
		assert.equal(await render, true);
		assert.deepEqual(workerCanvas.snapshot(), localCanvas.snapshot(), `${region}: ${shaders}`);
		remote.cancel();
	}
}
for (const data of [source, new Blob()]) {
	const spec = { kind: 'bar', source: data, width: 8, height: 8 };
	const localCanvas = new RenderCanvas();
	const workerCanvas = new RenderCanvas();
	const worker = new TestWorker();
	await new RenderEngine(localCanvas).render(spec);
	const engine = new RenderEngine(workerCanvas, { budget: 0, workerFactory: () => worker });
	const render = engine.render(spec);
	await worker.complete(0);
	await render;
	assert.deepEqual(workerCanvas.snapshot(), localCanvas.snapshot());
	engine.cancel();
}


for (const settings of [
 {region:'linear',coordinateSystem:'radial',axes:[0,1]},
 {region:'hilbert',coordinateSystem:'radial',axes:[1,0]},
 {region:'digraph',coordinateSystem:'radial',axes:[1,0]},
 {region:'dft',coordinateSystem:'radial',axes:[1,0]},
 {region:'trigraph',coordinateSystem:'cylindrical',axes:[2,1,0],frequencyOpacity:true},
 {region:'trigraph',coordinateSystem:'spherical',axes:[0,2,1],frequencyOpacity:false}
]) {
 const spec={...job,...settings};
 const localCanvas=new RenderCanvas(),remoteCanvas=new RenderCanvas(),worker=new TestWorker();
 await new RenderEngine(localCanvas,{budget:Infinity}).render(spec);
 const engine=new RenderEngine(remoteCanvas,{budget:0,workerFactory:()=>worker});
 const rendered=engine.render(spec);await worker.complete(0);await rendered;
 assert.deepEqual(remoteCanvas.snapshot(),localCanvas.snapshot());engine.cancel();
}

// Queue only the newest replacement; never clear the visible image while waiting.
const worker = new TestWorker();
const canvas = new RenderCanvas(7, 3);
const engine = new RenderEngine(canvas, { budget: 0, workerFactory: () => worker });
const initial = canvas.snapshot();
const first = engine.render(job);
const second = engine.render({ ...job, offset: 64 });
const third = engine.render({ ...job, offset: 96 });
assert.equal(await second, false);
assert.equal(worker.messages.length, 1);
assert.deepEqual(canvas.snapshot(), initial);
assert.equal(canvas.resizes, 0);
await worker.complete(0);
assert.equal(await first, false);
assert.equal(worker.messages.length, 2);
assert.equal(worker.messages[1].job.offset, 96);
assert.deepEqual(canvas.snapshot(), initial, 'Stale frame changed the visible image');
await worker.complete(1);
assert.equal(await third, true);
const expected = new RenderCanvas();
await executeRender(expected, { ...job, offset: 96 });
assert.deepEqual(canvas.snapshot(), expected.snapshot());

// The predictor should route tiny work locally and expensive work to a worker.
let created = 0;
const adaptiveWorker = new TestWorker();
const adaptive = new RenderEngine(new RenderCanvas(), { workerFactory: () => { created++; return adaptiveWorker; } });
await adaptive.render(job);
assert.equal(created, 0);
const large = { ...job, length: 65536, columns: 256, rows: 256 };
assert(adaptive.estimate(large) > adaptive.budget);
const largeRender = adaptive.render(large);
assert.equal(created, 1);
await adaptiveWorker.complete(0, 20);
await largeRender;
assert(adaptive.rates.size > 0, 'Render timings must update the predictor');
adaptive.cancel();

// Unsupported/broken workers fall back and disconnected canvases release work.
const broken = new TestWorker();
const fallback = new RenderEngine(new RenderCanvas(), { budget: 0, workerFactory: () => broken });
const recovery = fallback.render(job);
broken.onerror({ preventDefault() {} });
assert.equal(await recovery, true);
assert(broken.terminated);
assert.equal(fallback.supported, false);
const unavailable = new RenderEngine(new RenderCanvas(), { budget: 0, workerFactory: () => { throw new Error('Worker blocked'); } });
assert.equal(await unavailable.render(job), true);
const active = engine.render(job);
const pending = engine.render(job);
engine.cancel();
assert.equal(await active, false);
assert.equal(await pending, false);
assert(worker.terminated);


// During a continuous camera drag, completed poses must not all be discarded.
const rotationWorker = new TestWorker();
const rotationCanvas = new RenderCanvas();
const rotationEngine = new RenderEngine(rotationCanvas, { budget: 0, workerFactory: () => rotationWorker });
const cube = { ...job, region: 'trigraph', columns: 64, rows: 64, rotation: { yaw: 0, pitch: 0 } };
const pose1 = rotationEngine.render(cube);
const pose2 = rotationEngine.render({ ...cube, rotation: { yaw: 0.4, pitch: 0 } });
await rotationWorker.complete(0);
assert.equal(await pose1, true, 'Continuous pointer input starved presentation');
const firstPose = new RenderCanvas();
await executeRender(firstPose, cube);
assert.deepEqual(rotationCanvas.snapshot(), firstPose.snapshot());
const pose3 = rotationEngine.render({ ...cube, rotation: { yaw: 0.8, pitch: 0 } });
await rotationWorker.complete(1);
assert.equal(await pose2, true, 'Intermediate completed camera pose was discarded');
await rotationWorker.complete(2);
assert.equal(await pose3, true);
const beforeDataChange = rotationCanvas.snapshot();
const obsoleteData = rotationEngine.render(cube);
const changedData = rotationEngine.render({ ...cube, offset: 64 });
await rotationWorker.complete(3);
assert.equal(await obsoleteData, false);
assert.deepEqual(rotationCanvas.snapshot(), beforeDataChange, 'A different byte selection was presented');
await rotationWorker.complete(4);
assert.equal(await changedData, true);
rotationEngine.budget = Infinity;
const pinned = rotationEngine.render({ ...cube, offset: 64, rotation: { yaw: 1, pitch: 0 } });
assert.equal(rotationWorker.messages.length, 6, 'Rotation migrated away from its cached worker');
await rotationWorker.complete(5);
assert.equal(await pinned, true);
const olderPose = rotationEngine.render(cube);
rotationEngine.supported = false;
assert.equal(await rotationEngine.render({ ...cube, rotation: { yaw: 2, pitch: 0 } }), true);
const newestPose = rotationCanvas.snapshot();
await rotationWorker.complete(6);
assert.equal(await olderPose, false);
assert.deepEqual(rotationCanvas.snapshot(), newestPose, 'Older camera frame replaced a newer presented pose');
rotationEngine.cancel();


// Live scrolling should show completed intermediate ranges, but not an old file.
const scrollWorker = new TestWorker();
const scrollCanvas = new RenderCanvas();
const scrolling = new RenderEngine(scrollCanvas, { budget: 0, workerFactory: () => scrollWorker });
const scrollingJob = { ...job, progressive: true };
const range1 = scrolling.render(scrollingJob);
const range2 = scrolling.render({ ...scrollingJob, offset: 64 });
await scrollWorker.complete(0);
assert.equal(await range1, true, 'Live scrolling starved presentation');
await scrollWorker.complete(1);
assert.equal(await range2, true);
const visibleRange = scrollCanvas.snapshot();
const oldFile = scrolling.render(scrollingJob);
const newFile = scrolling.render({ ...scrollingJob, source: new Blob([new Uint8Array(100)]) });
await scrollWorker.complete(2);
assert.equal(await oldFile, false);
assert.deepEqual(scrollCanvas.snapshot(), visibleRange, 'A previous file was presented');
await scrollWorker.complete(3);
assert.equal(await newFile, true);
scrolling.cancel();


const styleWorker=new TestWorker(),styleEngine=new RenderEngine(new RenderCanvas(),{budget:0,workerFactory:()=>styleWorker});
const priorStyle=styleEngine.render({...cube,progressive:true});
const nextStyle=styleEngine.render({...cube,progressive:true,frequencyOpacity:true,coordinateSystem:'cylindrical',axes:[2,1,0]});
await styleWorker.complete(0);assert.equal(await priorStyle,false,'Old coordinate/opacity settings were presented');
await styleWorker.complete(1);assert.equal(await nextStyle,true);styleEngine.cancel();

// A quick local update must also supersede a slow in-flight worker frame.
const slowWorker = new TestWorker();
const mixedCanvas = new RenderCanvas();
const mixed = new RenderEngine(mixedCanvas, { workerFactory: () => slowWorker });
const slow = mixed.render(large);
mixed.offloaded.clear();
mixed.budget = Infinity;
assert.equal(await mixed.render({ ...job, offset: 64 }), true);
const visible = mixedCanvas.snapshot();
await slowWorker.complete(0);
assert.equal(await slow, false);
assert.deepEqual(mixedCanvas.snapshot(), visible);
mixed.cancel();

// Late events from a cancelled worker must not disable its replacement.
const oldWorker = new TestWorker(), newWorker = new TestWorker();
const workers = [oldWorker, newWorker];
const restarted = new RenderEngine(new RenderCanvas(), { budget: 0, workerFactory: () => workers.shift() });
const cancelled = restarted.render(job);
restarted.cancel();
assert.equal(await cancelled, false);
const resumed = restarted.render(job);
oldWorker.onerror({ preventDefault() {} });
assert.equal(restarted.supported, true);
assert.equal(newWorker.terminated, false);
await oldWorker.complete(0);
await newWorker.complete(0);
assert.equal(await resumed, true);
restarted.cancel();

// Independent checks guard against sharing the same rendering bug across paths.
assert(entropyShading(new Uint8Array(64)).every(value => value === 0));
assert.equal(entropyShading(Uint8Array.from({ length: 64 }, (_, i) => i))[32], 255);
for (const side of [1, 2, 4, 16]) {
	const cells = hilbertCells(side);
	assert.equal(new Set(cells).size, side * side);
	for (let i = 1; i < cells.length; i++) {
		assert.equal(Math.abs(cells[i] % side - cells[i - 1] % side) + Math.abs(Math.floor(cells[i] / side) - Math.floor(cells[i - 1] / side)), 1);
	}
}
const brightness = new RenderCanvas();
await executeRender(brightness, { ...job, shaders: ['brightness'] });
for (let i = 0; i < 16; i++) assert.deepEqual([...brightness.pixels.slice(i * 4, i * 4 + 4)], [32 + i, 32 + i, 32 + i, 255]);
const mix = cellColor(0, 0, ['entropy', 'brightness']);
assert(mix[0] > mix[1], 'Entropy hue must survive at a zero byte');
console.log('Render checks pass: local/worker parity, overlays, bars, adaptive routing, coalescing, stale frames, resource cleanup, fallback, shader math.');

// Camera progress and stage diagnostics belong to any 3D configuration, not a preset name.
for(const region of ['linear','hilbert3d']) {
 const worker=new TestWorker(),engine=new RenderEngine(new RenderCanvas(),{budget:0,workerFactory:()=>worker});
 const frames=[];engine.onFrame=frame=>frames.push(frame);
 const settings={...job,region,configuration:{space:'cube',population:'bytes',footprint:'point',sampleLimit:16,
  position:['value','byte2','byte3'],inverted:[false,false,false],backend:'cpu'},sampleLayout:{columns:4,rows:4}};
 const first=engine.render({...settings,rotation:{yaw:0,pitch:0}});
 const second=engine.render({...settings,rotation:{yaw:1,pitch:0}});
 await worker.complete(0);assert.equal(await first,true,'Custom 3D camera was starved');
 await worker.complete(1);assert.equal(await second,true);
 assert(frames.length===2&&frames.every(frame=>frame.timings&&frame.reused),'Worker lost stage diagnostics');
 engine.cancel();
}
