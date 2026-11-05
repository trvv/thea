import assert from 'node:assert/strict';
import { executeRender } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';

const canvas = new RenderCanvas();
async function draw(data, offset = 0, length = data.length - offset, shaders = ['entropy', 'brightness']) {
	await executeRender(canvas, {
		kind: 'view', source: new Blob([Uint8Array.from(data)]), offset, length,
		region: 'digraph', columns: 256, rows: 256, shaders
	});
	return canvas.pixels.slice();
}
const brightness = (pixels, x, y) => pixels[(y * 256 + x) * 4];

let pixels = await draw([99, 1, 2, 3, 88], 1, 3);
assert.equal(canvas.width, 256);
assert.equal(canvas.height, 256);
assert.equal(brightness(pixels, 1, 2), 255);
assert.equal(brightness(pixels, 2, 3), 255, 'Middle byte must participate in both overlapping pairs');
assert.equal(brightness(pixels, 1, 3), 0);
assert.equal(brightness(pixels, 2, 1), 0, 'X and Y must not be transposed');
assert.equal(brightness(pixels, 99, 1), 0, 'Pair crosses the selected start');
assert.equal(brightness(pixels, 3, 88), 0, 'Pair crosses the selected end');
assert.equal([...pixels].filter((value, i) => i % 4 === 0 && value > 0).length, 2);

pixels = await draw([1, 2, 1, 2, 1, 2, 3]);
assert(brightness(pixels, 1, 2) > brightness(pixels, 2, 1));
assert(brightness(pixels, 2, 1) > brightness(pixels, 2, 3));
assert.equal(brightness(pixels, 1, 2), 255);
assert.equal(brightness(pixels, 2, 1), Math.round(255 * Math.log1p(2) / Math.log1p(3)));

for (const bytes of [[], [255]]) {
	pixels = await draw(bytes);
	for (let i = 0; i < pixels.length; i += 4) assert.deepEqual([...pixels.slice(i, i + 4)], [0, 0, 0, 255]);
}
pixels = await draw([0, 255, 0]);
assert.equal(brightness(pixels, 0, 255), 255);
assert.equal(brightness(pixels, 255, 0), 255);
pixels = await draw([0, 0]);
assert.equal(brightness(pixels, 0, 0), 255);
assert.equal(brightness(pixels, 0, 255), 0, 'Previous render leaked into the histogram');

// Adjacent pairs continue over read chunks, but never beyond the selection.
const large = new Uint8Array(65538);
large[65536] = 2;
large[65537] = 99;
pixels = await draw(large, 0, 65537);
assert(brightness(pixels, 0, 2) > 0, 'Pair across a chunk boundary was lost');
assert.equal(brightness(pixels, 2, 99), 0);
const reference = new Float64Array(65536);
for (let i = 0; i + 1 < 65537; i++) reference[large[i + 1] * 256 + large[i]]++;
const max = Math.max(...reference);
for (let i = 0; i < reference.length; i++) {
	assert.equal(pixels[i * 4], Math.round(255 * Math.log1p(reference[i]) / Math.log1p(max)));
}
assert.deepEqual(await draw([1, 2, 3], 0, 3, ['character', 'entropy', 'brightness']), await draw([1, 2, 3], 0, 3, []));
console.log('Digraph checks pass: overlapping pairs, axis order, frequency brightness, selection bounds, empty/single-byte input, chunk boundaries, reset, shader independence.');
