import { applyImageCoordinates } from './coordinates.js';
import { overviewValues } from './overview.js';
import { trigraphCounts, trigraphImage } from './trigraph.js';
import { fourierCost, fourierImage } from './fourier.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// CP437 high-byte glyphs; control pictures remain consistent across encodings.
const cp437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xa0';

export function byteCharacter(byte, encoding, blankSpaces = false, blankNulls = true) {
	if (encoding === 'ascii-overbar' && byte >= 128) {
		return byteCharacter(byte & 0x7f, 'ascii', blankSpaces, blankNulls) + '\u0305';
	}
	if ((byte === 0 && blankNulls) || (byte === 32 && blankSpaces)) return ' ';
	if (byte <= 32) return String.fromCharCode(0x2400 + byte);
	if (byte === 127) return '\u2421';
	if (byte < 127) return String.fromCharCode(byte);
	if (encoding === 'cp437') return cp437[byte - 128];
	if (encoding === 'latin1' && byte >= 160) return String.fromCharCode(byte);
	return '·';
}

// Map Hilbert traversal indices to row-major cells in a power-of-two square.
export function hilbertCells(side) {
	const cells = new Uint32Array(side * side);
	for (let index = 0; index < cells.length; index++) {
		let x = 0, y = 0, remaining = index;
		for (let scale = 1; scale < side; scale *= 2) {
			const rx = Math.floor(remaining / 2) & 1;
			const ry = (remaining ^ rx) & 1;
			if (!ry) {
				if (rx) { x = scale - 1 - x; y = scale - 1 - y; }
				[x, y] = [y, x];
			}
			x += scale * rx;
			y += scale * ry;
			remaining = Math.floor(remaining / 4);
		}
		cells[index] = y * side + x;
	}
	return cells;
}

// Shannon entropy in a moving 32-byte neighborhood, scaled from 0 to 255.
export function entropyShading(bytes) {
	const values = new Uint8Array(bytes.length);
	const counts = new Uint8Array(256);
	const weights = Array.from({ length: 33 }, (_, n) => n ? n * Math.log2(n) : 0);
	let start = 0, end = 0, sum = 0;
	const update = (byte, delta) => {
		const count = counts[byte];
		sum += weights[count + delta] - weights[count];
		counts[byte] += delta;
	};
	for (let i = 0; i < bytes.length; i++) {
		while (start < Math.max(0, i - 16)) update(bytes[start++], -1);
		while (end < Math.min(bytes.length, i + 16)) update(bytes[end++], 1);
		const length = end - start;
		values[i] = Math.round(clamp((Math.log2(length) - sum / length) / 5, 0, 1) * 255);
	}
	return values;
}

// Combined shaders use HSL: entropy supplies hue, byte value supplies lightness.
export function cellColor(value, entropy, shaders) {
	const brightness = shaders.includes('brightness');
	const varied = shaders.includes('entropy');
	if (!brightness || !varied) {
		const gray = brightness ? value : varied ? entropy : 255;
		return [gray, gray, gray];
	}
	const hue = (entropy / 255) * 300;
	const lightness = 0.15 + (value / 255) * 0.70;
	const amplitude = 0.75 * Math.min(lightness, 1 - lightness);
	return [0, 8, 4].map(channel => {
		const k = (channel + hue / 30) % 12;
		return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	});
}

const grayscaleFrames = new WeakMap();

export function paintBytes(canvas, values, width = canvas.width, height = canvas.height, cells) {
	// Resize and draw together, only once the next image is ready.
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	const context = canvas.getContext('2d');
	let frame = grayscaleFrames.get(canvas);
	if (!frame || frame.width !== width || frame.height !== height) {
		frame = { width, height, image: context.createImageData(width, height) };
		grayscaleFrames.set(canvas, frame);
	}
	const image = frame.image;
	const count = width * height;
	// Histogram/DFT/cube images already contain one value per output pixel.
	// Avoid resampling math and a temporary array for every pixel.
	if (!cells && values.length === count) {
		const rgba = image.data;
		for (let i = 0, offset = 0; i < count; i++, offset += 4) {
			rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = values[i];
			rgba[offset + 3] = 255;
		}
		context.putImageData(image, 0, 0);
		return;
	}
	// Other byte ranges may still need resampling.
	for (let i = 0; i < count; i++) {
		if (cells) {
			const value = values[Math.floor(i * values.length / count)] || 0;
			image.data.set([value, value, value, 255], cells[i] * 4);
			continue;
		}
		const start = Math.floor(i * values.length / count);
		const end = Math.min(values.length, Math.max(start + 1, Math.floor((i + 1) * values.length / count)));
		let value = 0;
		for (let j = start; j < end; j++) value += values[j];
		value = end > start ? value / (end - start) : 0;
		image.data.set([value, value, value, 255], (cells ? cells[i] : i) * 4);
	}
	context.putImageData(image, 0, 0);
}

// Byte and entropy values are 8-bit, so their combined colors fit in a small LUT.
const grayColors = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) grayColors.set([i, i, i, 255], i * 4);
const grayPixels = new Uint32Array(grayColors.buffer);
const clampedGray = new Uint8ClampedArray(1);
function grayIndex(value) { clampedGray[0] = value; return clampedGray[0]; }
let mixedPixels;
function mixedPalette() {
	if (!mixedPixels) {
		const bytes = new Uint8ClampedArray(256 * 256 * 4);
		const shaders = ['entropy', 'brightness'];
		for (let entropy = 0; entropy < 256; entropy++) for (let value = 0; value < 256; value++) {
			bytes.set([...cellColor(value, entropy, shaders), 255], (entropy * 256 + value) * 4);
		}
		mixedPixels = new Uint32Array(bytes.buffer);
	}
	return mixedPixels;
}

export function paintView(canvas, bytes, entropy, columns, rows, cells, shaders, options) {
	const hex = shaders.includes('hex');
	const text = hex || shaders.includes('character');
	const scale = options.scale;
	const width = text ? Math.max(1, Math.round(options.width * scale)) : columns;
	const height = text ? Math.max(1, Math.round(options.height * scale)) : rows;
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	const context = canvas.getContext('2d');
	const cellWidth = width / columns;
	const cellHeight = height / rows;
	const count = columns * rows;
	const image = text ? null : context.createImageData(width, height);
	const packed = image ? new Uint32Array(image.data.buffer, image.data.byteOffset, count) : null;
	const brightness = shaders.includes('brightness'), varied = shaders.includes('entropy');
	const palette = !text && brightness && varied ? mixedPalette() : null;
	if (text) {
		context.fillStyle = 'white';
		context.fillRect(0, 0, width, height);
		context.font = `${Math.min(cellWidth / (hex ? 1.2 : 0.6), cellHeight) * 0.85}px monospace`;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
	}
	for (let index = 0; index < count; index++) {
		const sample = cells || bytes.length > count ? Math.floor(index * bytes.length / count) : index;
		if (sample >= bytes.length) continue;
		let byte = bytes[sample] || 0;
		let metric = entropy?.[sample] || 0;
		if (!text && !cells && bytes.length > count) {
			const end = Math.floor((index + 1) * bytes.length / count);
			byte = metric = 0;
			for (let i = sample; i < end; i++) { byte += bytes[i]; metric += entropy?.[i] || 0; }
			byte /= end - sample;
			metric /= end - sample;
		}
		const cell = cells ? cells[index] : index;
		if (!text) {
			if (!brightness && !varied) packed[cell] = grayPixels[255];
			else if (!brightness || !varied) packed[cell] = grayPixels[grayIndex(brightness ? byte : metric)];
			else if (Number.isInteger(byte) && Number.isInteger(metric)) packed[cell] = palette[metric * 256 + byte];
			else image.data.set([...cellColor(byte, metric, shaders), 255], cell * 4);
			continue;
		}
		const color = cellColor(byte, metric, shaders);
		const x = cell % columns * cellWidth;
		const y = Math.floor(cell / columns) * cellHeight;
		context.fillStyle = `rgb(${color.join(',')})`;
		context.fillRect(x, y, cellWidth, cellHeight);
		if (!bytes.length) continue;
		context.fillStyle = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114 > 128 ? 'black' : 'white';
		const character = hex ? byte.toString(16).padStart(2, '0').toUpperCase()
			: byteCharacter(byte, options.encoding, options.blankSpaces, options.blankNulls);
		context.fillText(character, x + cellWidth / 2, y + cellHeight / 2);
	}
	if (image) context.putImageData(image, 0, 0);
}

// A sliding pair (first byte = X, next byte = Y) occupies one fixed grid cell.
export function paintDigraph(canvas, counts) {
	let peak = 0;
	for (const count of counts) peak = Math.max(peak, count);
	const values = new Uint8Array(256 * 256);
	const scale = peak ? 255 / Math.log1p(peak) : 0;
	for (let i = 0; i < values.length; i++) values[i] = Math.round(Math.log1p(counts[i]) * scale);
	paintBytes(canvas, values, 256, 256);
}

// Include preparation and painting in the estimate, rather than just output size.
export function renderCost(job) {
	if (job.kind === 'bar') return (job.length ?? job.source.size) + job.width * job.height * 8;
	if (job.region === 'trigraph') return job.length * (job.frequencyOpacity ? 65 : 33) + job.columns * job.rows * (job.frequencyOpacity ? 12 : 8);
	if (job.region === 'dft') return fourierCost(job.length) + job.columns * job.rows * (job.coordinateSystem === 'radial' ? 64 : 8);
	if (job.region === 'digraph') return job.length * 2 + (job.coordinateSystem === 'radial' ? 1024 * 1024 * 32 : 256 * 256 * 8);
	const cells = job.columns * job.rows;
	const remapping = job.coordinateSystem === 'radial' ? Math.min(1024, job.width || job.columns) * Math.min(1024, job.height || job.rows) * 32 : 0;
	const text = job.shaders.includes('character') || job.shaders.includes('hex');
	return remapping + job.length * (job.shaders.includes('entropy') ? 6 : 1)
		+ cells * (8 + (job.region === 'hilbert' ? Math.log2(job.columns) : 0) + (text ? 32 : 0))
		+ (text ? job.width * job.height * job.scale ** 2 / 4 : 0);
}

// The same renderer runs on the UI thread and in the worker.
export async function executeRender(canvas, job, cache = {}, current = () => true) {
	let duration = 0, work;
	if (!current()) return null;
	if (job.kind === 'bar') {
		const overview = await overviewValues(job, cache, current);
		if (!overview || !current()) return null;
		const started = performance.now();
		paintBytes(canvas, overview.values, job.width, job.height);
		duration = overview.duration + performance.now() - started;
		work = overview.bytesRead + job.width * job.height * 8;
	} else if (job.region === 'trigraph') {
		const histogram = await trigraphCounts(job, cache, current);
		if (!histogram || !current()) return null;
		const started = performance.now();
		const values = trigraphImage(histogram.counts, job.columns, job.rows, job.rotation, cache.trigraphRaster ||= {}, histogram, job);
		paintBytes(canvas, values, job.columns, job.rows);
		duration = histogram.duration + performance.now() - started;
		work = (histogram.bytesRead * 3) + histogram.counts.size * 30 + job.columns * job.rows * 8;
	} else if (job.region === 'dft') {
		const bytes = new Uint8Array(await job.source.slice(job.offset, job.offset + job.length).arrayBuffer());
		if (!current()) return null;
		const started = performance.now();
		const values = fourierImage(bytes, job.columns, job.rows);
		paintBytes(canvas, values, job.columns, job.rows);
		duration = performance.now() - started;
	} else if (job.region === 'digraph') {
		const counts = new Float64Array(256 * 256);
		let previous;
		for (let offset = job.offset; offset < job.offset + job.length;) {
			const end = Math.min(offset + 65536, job.offset + job.length);
			const bytes = new Uint8Array(await job.source.slice(offset, end).arrayBuffer());
			if (!current()) return null;
			if (!bytes.length) throw new Error('Byte source ended before its declared size.');
			const started = performance.now();
			for (const byte of bytes) {
				if (previous !== undefined) counts[byte * 256 + previous]++;
				previous = byte;
			}
			duration += performance.now() - started;
			offset += bytes.length;
		}
		if (!current()) return null;
		const started = performance.now();
		paintDigraph(canvas, counts);
		duration += performance.now() - started;
	} else {
		const shaded = job.shaders.includes('entropy');
		const start = shaded ? Math.max(0, job.offset - 16) : job.offset;
		const end = job.offset + job.length + (shaded ? 15 : 0);
		const data = new Uint8Array(await job.source.slice(start, end).arrayBuffer());
		if (!current()) return null;
		const started = performance.now();
		const first = job.offset - start;
		const bytes = data.subarray(first, first + job.length);
		const entropy = shaded ? entropyShading(data).subarray(first, first + job.length) : null;
		let cells;
		if (job.region === 'hilbert') {
			if (cache.side !== job.columns) {
				cache.cells = hilbertCells(job.columns);
				cache.side = job.columns;
			}
			cells = cache.cells;
		}
		paintView(canvas, bytes, entropy, job.columns, job.rows, cells, job.shaders, job);
		duration = performance.now() - started;
	}
	const remapStarted = performance.now();
	applyImageCoordinates(canvas, job);
	duration += performance.now() - remapStarted;
	return { duration, work };
}
