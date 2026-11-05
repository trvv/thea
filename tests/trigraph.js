import assert from 'node:assert/strict';
import { trigraphCounts } from '../histograms.js';
import { projectedPointSize } from '../point-projection.js';
import { executeRender } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';

const packed = (x, y, z) => x * 65536 + y * 256 + z;
const blob = values => new Blob([Uint8Array.from(values)]);
let job = { source: blob([99, 1, 2, 3, 4, 88]), offset: 1, length: 4 };
let histogram = await trigraphCounts(job, {});
assert.deepEqual([...histogram.counts], [[packed(1, 2, 3), 1], [packed(2, 3, 4), 1]]);
histogram = await trigraphCounts({ source: blob([1, 2, 3, 1, 2, 3, 1]), offset: 0, length: 7 }, {});
assert.equal(histogram.counts.get(packed(1, 2, 3)), 2);
assert.equal(histogram.counts.get(packed(2, 3, 1)), 2);
assert.equal(histogram.counts.get(packed(3, 1, 2)), 1);
assert.equal([...histogram.counts.values()].reduce((a, b) => a + b), 5);
for (const values of [[], [0], [0, 255]]) {
	assert.equal((await trigraphCounts({ source: blob(values), offset: 0, length: values.length }, {})).counts.size, 0);
}
const bytes = new Uint8Array(65539);
bytes[65536] = 2; bytes[65537] = 3; bytes[65538] = 99;
histogram = await trigraphCounts({ source: new Blob([bytes]), offset: 0, length: 65538 }, {});
assert.equal(histogram.counts.get(packed(0, 0, 2)), 1);
assert.equal(histogram.counts.get(packed(0, 2, 3)), 1);
assert.equal(histogram.counts.has(packed(2, 3, 99)), false);
assert.equal([...histogram.counts.values()].reduce((a, b) => a + b), 65536);

const cache = {};
job = { ...job, sourceId: 1 };
const first = await trigraphCounts(job, cache);
const reused = await trigraphCounts({ ...job, source: job.source.slice() }, cache);
assert.equal(reused.counts, first.counts, 'Blob cloning should not invalidate the camera cache');
assert.equal(reused.read, false);
assert.notEqual((await trigraphCounts({ ...job, sourceId: 2 }, cache)).counts, first.counts);
assert.notEqual((await trigraphCounts({ ...job, offset: 0 }, cache)).counts, first.counts);
assert.equal(await trigraphCounts(job, {}, () => false), null);

const rotation={yaw:0,pitch:0},canvas=new RenderCanvas(),renderCache={};
const spec={...job,kind:'view',region:'trigraph',columns:257,rows:257,rotation,shaders:[]};
await executeRender(canvas,spec,renderCache);const prepared=renderCache.preparedPoints;
const original=canvas.pixels.slice();
await executeRender(canvas,{...spec,rotation:{yaw:0.8,pitch:0.4}},renderCache);
assert.equal(renderCache.preparedPoints,prepared,'Rotation rebuilt geometry');
assert.notDeepEqual(canvas.pixels,original,'Rotation did not affect the view');
assert(Math.abs(projectedPointSize(0.0001)-projectedPointSize(-0.0001))<0.001);
assert(projectedPointSize(1)>projectedPointSize(0)&&projectedPointSize(0)>projectedPointSize(-1));
let seed=573;const random=Uint8Array.from({length:8000},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
const scrollingSource=new Blob([random]),scrollingCache={},actual=new RenderCanvas(),fresh=new RenderCanvas();
for(let frame=0;frame<30;frame++) {
 const settings={...spec,source:scrollingSource,sourceId:2,offset:frame<15?frame*17:2000-frame*13,length:frame%7===0?1800:2000,
  columns:frame<20?129:151,rows:101,pointScale:frame<10?2:0.5,rotation:{yaw:frame<20?-0.6:0.2,pitch:0.45}};
 await executeRender(actual,settings,scrollingCache);await executeRender(fresh,settings);
 assert.deepEqual(actual.pixels,fresh.pixels,`Cached/fresh rendering differs at frame ${frame}`);
}
console.log('Trigraph checks pass: tuple boundaries, histogram reuse, perspective size, rotation, cached/fresh scroll equivalence, camera/viewport/DPR invalidation.');
