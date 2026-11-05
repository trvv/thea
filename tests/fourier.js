import assert from 'node:assert/strict';
import { fourierSpectrum } from '../fourier.js';
import { spectrumComponents } from '../spectrum.js';
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

const length=64;
const tone=(bin,phase=0,amplitude=1)=>Float64Array.from({length},(_,i)=>amplitude*Math.cos(2*Math.PI*bin*i/length+phase));
for(const [phase,normalized] of [[0,0.5],[Math.PI/2,0.75],[-Math.PI/2,0.25],[Math.PI,1]]) {
 const spectrum=spectrumComponents(fourierSpectrum(tone(7,phase)),length,true,true);
 assert(Math.abs(spectrum.phases[7]-normalized)<1e-10,'Phase convention changed');
 assert.equal(spectrum.amplitudes[7],1);
 assert.equal(spectrum.amplitudes.filter(Boolean).length,1,'Numerical noise created spurious amplitude');
}
for(const [samples,bin] of [[new Uint8Array(length).fill(123),0],[Float64Array.from({length},(_,i)=>i%2?-1:1),length/2]]) {
 const spectrum=spectrumComponents(fourierSpectrum(samples),length,true,true);
 assert.equal(spectrum.phases[bin],0.5);assert.equal(spectrum.amplitudes[bin],1);
 assert.equal(spectrum.amplitudes.filter(Boolean).length,1);
}
const combined=Float64Array.from(tone(5), (value,i)=>value+tone(12,0,0.25)[i]);
const amplitudes=spectrumComponents(fourierSpectrum(combined),length,false,true).amplitudes;
assert(amplitudes[5]>amplitudes[12]&&amplitudes[12]>0);
const source=new Blob([new Uint8Array([255,...new Array(7).fill(12),0])]),cache={};
const job={kind:'view',source,offset:1,length:7,columns:129,rows:129,region:'dft',shaders:[]};
await executeRender(new RenderCanvas(),job,cache);
assert.equal(cache.preparedPoints.size,4);
assert(Math.abs(cache.preparedPoints.positions[0])<1e-7,'DC phase is not centered');
assert.equal(cache.preparedPoints.positions[1],1,'Zero frequency is not at the bottom');
for(let k=0;k<4;k++) {
 assert(Math.abs(cache.preparedPoints.positions[k*3+1]-(1-4*k/7))<1e-6,'Frequency coordinates changed');
 assert.equal(cache.preparedPoints.colors[k*4],k===0?255:0);
}
assert(renderCost({...job,length:1000000})>renderCost(job),'Worker estimate ignores FFT size');
console.log('DFT checks pass: defining DFT sum, arbitrary lengths, phase, amplitude, DC/Nyquist, selection bounds, bin coordinates, worker cost.');
