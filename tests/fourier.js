import assert from 'node:assert/strict';
import { fourierSpectrum, fourierImage } from '../fourier.js';
import { executeRender, renderCost } from '../rendering.js';
import { RenderCanvas } from './render-canvas.js';

// Compare both FFT paths against the defining DFT sum, including prime lengths.
for (const length of [0, 1, 2, 3, 4, 5, 7, 8, 11, 16, 31, 64]) {
	const samples = Float64Array.from({ length }, (_, i) => (i * i + 17 * i) % 255);
	const { real, imaginary } = fourierSpectrum(samples);
	assert.equal(real.length, length);
	assert.equal(imaginary.length, length);
	for (let k = 0; k < length; k++) {
		let re = 0, im = 0;
		for (let i = 0; i < length; i++) {
			const angle = 2 * Math.PI * k * i / length;
			re += samples[i] * Math.cos(angle);
			im -= samples[i] * Math.sin(angle);
		}
		assert(Math.abs(real[k] - re) < 1e-7, `Real DFT mismatch: N=${length}, k=${k}`);
		assert(Math.abs(imaginary[k] - im) < 1e-7, `Imaginary DFT mismatch: N=${length}, k=${k}`);
	}
}

const width = 513, height = 129, length = 64;
const tone = (bin, phase = 0, amplitude = 1) => Float64Array.from({ length }, (_, i) => amplitude * Math.cos(2 * Math.PI * bin * i / length + phase));
const pixel = (image, x, y) => image[y * width + x];
const frequencyRow = bin => height - 1 - Math.round(2 * bin / length * (height - 1));
for (const [phase, x] of [[0, 256], [Math.PI / 2, 384], [-Math.PI / 2, 128], [Math.PI, 512]]) {
	const image = fourierImage(tone(7, phase), width, height);
	assert.equal(pixel(image, x, frequencyRow(7)), 255, `Wrong phase/frequency mapping: ${phase}`);
	assert.equal(image.filter(Boolean).length, 1, 'Numerical noise created spurious points');
}
const constant = fourierImage(new Uint8Array(length).fill(123), width, height);
assert.equal(pixel(constant, 256, height - 1), 255, 'DC is not centered on the bottom row');
assert.equal(constant.filter(Boolean).length, 1);
const nyquist = fourierImage(Float64Array.from({ length }, (_, i) => i % 2 ? -1 : 1), width, height);
assert.equal(pixel(nyquist, 256, 0), 255, 'Nyquist is not at the top');
const weakerTone = tone(12, 0, 0.25);
const twoTones = Float64Array.from(tone(5), (value, i) => value + weakerTone[i]);
const mixed = fourierImage(twoTones, width, height);
assert(pixel(mixed, 256, frequencyRow(5)) > pixel(mixed, 256, frequencyRow(12)), 'Brightness does not reflect amplitude');
assert(pixel(mixed, 256, frequencyRow(12)) > 0);
for (const data of [new Uint8Array(), new Uint8Array(1), new Uint8Array(17)]) assert(fourierImage(data, width, height).every(value => value === 0));
assert.equal(fourierImage(new Uint8Array([42]), width, height).filter(Boolean).length, 1);

const source = new Blob([new Uint8Array([255, ...new Array(7).fill(12), 0])]);
const job = { kind: 'view', source, offset: 1, length: 7, columns: width, rows: height, region: 'dft', shaders: ['entropy', 'brightness', 'character'] };
const canvas = new RenderCanvas();
await executeRender(canvas, job);
const expected = fourierImage(new Uint8Array(7).fill(12), width, height);
for (let i = 0; i < expected.length; i++) {
	assert.deepEqual([...canvas.pixels.subarray(i * 4, i * 4 + 4)], [expected[i], expected[i], expected[i], 255]);
}
assert.equal(canvas.commands.length, 0, 'DFT applied character overlays');
assert(renderCost({ ...job, length: 1000000 }) > renderCost(job), 'Worker estimate ignores FFT size');
console.log('DFT checks pass: direct-sum reference, arbitrary lengths, phase sign/center, frequency orientation, amplitude, DC/Nyquist, empty data, selection bounds, worker cost.');
