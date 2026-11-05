import assert from 'node:assert/strict';
import { trigraphCounts, cubeProjection, trigraphImage } from '../trigraph.js';
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

const rotation = { yaw: 0, pitch: 0 };
const project = cubeProjection(257, 257, rotation);
assert(project(0, 128, 128).x < project(255, 128, 128).x);
assert(project(128, 255, 128).y < project(128, 0, 128).y);
assert(project(255, 128, 255).x > project(255, 128, 0).x, 'Perspective does not distinguish depth');
const counts = new Map([[packed(32, 64, 32), 5], [packed(220, 180, 40), 1]]);
let image = trigraphImage(counts, 257, 257, rotation);
const bright = project(32, 64, 32), faint = project(220, 180, 40);
assert.equal(image[Math.round(bright.y) * 257 + Math.round(bright.x)], 255);
assert(image[Math.round(faint.y) * 257 + Math.round(faint.x)] < 255);
assert.notDeepEqual(image, trigraphImage(counts, 257, 257, { yaw: 0.8, pitch: 0.4 }));
const overlapping = [[packed(128, 128, 255), 1], [packed(128, 128, 0), 10]];
assert.deepEqual(trigraphImage(new Map(overlapping), 257, 257, rotation), trigraphImage(new Map(overlapping.toReversed()), 257, 257, rotation), 'Occlusion depends on histogram insertion order');
assert(trigraphImage(new Map(), 257, 257, rotation).some(value => value === 48), 'Missing cube wireframe');
for (let i = 0; i < 20; i++) {
	const projection = cubeProjection(320, 120, { yaw: i, pitch: i / 7 });
	for (const x of [0, 255]) for (const y of [0, 255]) for (const z of [0, 255]) {
		const point = projection(x, y, z);
		assert(point.x >= 0 && point.x < 320 && point.y >= 0 && point.y < 120);
	}
}
const canvas = new RenderCanvas();
const renderCache = {};
const spec = { ...job, kind: 'view', region: 'trigraph', columns: 257, rows: 257, rotation };
const initial = await executeRender(canvas, spec, renderCache);
const rotated = await executeRender(canvas, { ...spec, rotation: { yaw: 1, pitch: 0.2 } }, renderCache);
assert(rotated.work < initial.work, 'Rotation estimates still include histogram construction');
assert.equal(canvas.width, 257);
assert.equal(canvas.height, 257);
console.log('Trigraph checks pass: sliding triples, selection/chunk boundaries, histogram reuse, perspective, rotation, depth, frequency brightness, wireframe, worker cost.');

// The footprint must change continuously across the former front/back cutoff.
const { projectedPointSize } = await import('../trigraph.js');
assert(Math.abs(projectedPointSize(0.0001) - projectedPointSize(-0.0001)) < 0.001);
assert(projectedPointSize(1) > projectedPointSize(0));
assert(projectedPointSize(0) > projectedPointSize(-1));
const background = trigraphImage(new Map(), 257, 257, rotation);
const energy = z => {
 const pixels = trigraphImage(new Map([[packed(128, 128, z), 1]]), 257, 257, rotation);
 return pixels.reduce((sum, value, i) => sum + Math.max(0, value - background[i]), 0);
};
assert(Math.abs(energy(128) - energy(127)) / energy(127) < 0.03, 'Particle area jumps at the center plane');

// Verify dirty-tile repair against a fresh full redraw while slots are added,
// removed, swapped, resized and reprojected. No approximation is permitted.
let seed = 573;
const randomBytes = Uint8Array.from({ length: 80000 }, () => {
 seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed & 255;
});
const scrollingSource = new Blob([randomBytes]);
const scrollingCache = {}, raster = {};
let repaired = false, reusedProjection = false;
for (let frame = 0; frame < 60; frame++) {
 const offset = frame < 30 ? frame * 17 : 15000 - frame * 13;
 const length = frame % 13 === 0 ? 18000 : 20000;
 const histogram = await trigraphCounts({ source: scrollingSource, offset, length }, scrollingCache);
 const pose = { yaw: frame < 40 ? -0.6 : 0.2, pitch: 0.45 };
 const width = frame < 50 ? 257 : 301, height = 193;
 const actual = trigraphImage(histogram.counts, width, height, pose, raster, histogram).slice();
 const expected = trigraphImage(histogram.counts, width, height, pose);
 assert.deepEqual(actual, expected, `Incremental visibility differs from full redraw at frame ${frame}`);
 if (!raster.points.full && raster.points.dirty.size) {
  repaired = true;
  if (raster.points.projectedCount < raster.points.size / 10) reusedProjection = true;
 }
 const seen = new Set();
 for (let bin = 0; bin < raster.points.heads.length; bin++) {
  let previous = -1;
  for (let i = raster.points.heads[bin]; i >= 0; i = raster.points.next[i]) {
   assert(!seen.has(i), 'Spatial index contains a duplicate or cycle');
   seen.add(i);
   assert.equal(raster.points.previous[i], previous);
   assert.equal(raster.points.bin[i], bin);
   previous = i;
  }
 }
 assert.equal(seen.size, raster.points.size, 'Spatial index lost points');
}
assert(repaired && reusedProjection, 'Autoscroll never reused cached projection/visibility');
console.log('Particle checks pass: continuous perspective sizing, smooth center-plane coverage, exact visibility repair, spatial index integrity, camera/viewport invalidation.');

// Soft front edges must reveal rear samples, rather than fading against black.
const behind = packed(128, 128, 0), inFront = packed(129, 128, 255);
const edgeScratch = {};
const edgeImage = trigraphImage(new Map([[behind, 10], [inFront, 1]]), 257, 257, rotation, edgeScratch);
const center = 128 * 257 + 128;
const frontShade = Math.round(64 + Math.log1p(1) * 191 / Math.log1p(10));
assert.deepEqual([...edgeScratch.owners.subarray(center * 4, center * 4 + 4)], [1, 2, 1, 2]);
assert.equal(edgeImage[center], Math.round((255 + frontShade) / 2), 'Soft particle edge introduced a black outline');
console.log('Edge checks pass: rear particles remain visible through partially covered foreground pixels.');

// Changing raster density must preserve point sizes in display pixels and query
// enough neighboring bins for the larger high-DPI footprints.
const densityCache={},densityRaster={};
for(let frame=0;frame<16;frame++){
 const histogram=await trigraphCounts({source:scrollingSource,offset:frame*11,length:12000},densityCache);
 const options={pointScale:frame<8?2:0.5};
 const pose={yaw:-0.6,pitch:0.45};
 const actual=trigraphImage(histogram.counts,257,193,pose,densityRaster,histogram,options).slice();
 const expected=trigraphImage(histogram.counts,257,193,pose,{},undefined,options);
 assert.deepEqual(actual,expected,'High-DPI/adaptive footprint repair missed neighboring particles');
 assert(densityRaster.points.binRadius>=(frame<8?2:1));
}
console.log('Density checks pass: high-DPI point footprints and cached repairs across resolution changes.');
