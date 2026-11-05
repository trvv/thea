/**
 * Shared local/worker entry point plus optimized preset painters. A configured recipe view returns
 * before legacy image-coordinate remapping.
 * @module rendering
 * @see docs/rendering.md
 */
import { compileRecipes, recipeRoots } from './recipes.js';
import { defaultSampleLimit } from './populations.js';
import { spaces } from './point-configuration.js';
import { requiredFactors } from './factors.js';
import { renderPoints } from './point-renderer.js';
import { compileAppearance, defaultAppearance, paintAppearanceGrid, occurrenceFactor } from './appearance.js';
import { applyImageCoordinates } from './coordinates.js';
import { overviewValues } from './overview.js';
import { trigraphCounts, trigraphImage, paintTrigraphAppearance } from './trigraph.js';
import { fourierCost, fourierImage } from './fourier.js';
import { matchingSpectrum, prepareSpectrum } from './spectrum.js';
import { windowCounts } from './histograms.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// CP437 high-byte glyphs; control pictures remain consistent across encodings.
const cp437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xa0';

/**
 * Distinguish invisible control bytes without interpreting a multibyte text stream. Blank NUL/SP
 * toggles are independent, and higher-byte glyphs depend on the chosen single-byte encoding.
 */
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
/**
 * Produce a traversal-to-cell permutation, not a byte reorder. Callers must pass a power-of-two
 * side so every cell is visited exactly once.
 */
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
/**
 * Use a rolling Shannon statistic so overlapping neighborhoods do not rescan 32 bytes per point.
 * The 5-bit divisor is the maximum entropy achievable in a 32-byte sample.
 */
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
/**
 * Reserve lightness headroom so 00 and FF retain entropy hue. Native LUT generation and general
 * appearance defaults must preserve this color convention.
 */
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

/**
 * Reuse image storage and delay resizing until replacement pixels are ready; clearing an old canvas
 * before an awaited render was a source of flicker.
 */
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
/**
 * Match Uint8ClampedArray rounding exactly when selecting a prepacked gray pixel, including
 * half-integer averages.
 */
function grayIndex(value) { clampedGray[0] = value; return clampedGray[0]; }
let mixedPixels;
/**
 * Cache all 65,536 byte/entropy colors instead of evaluating HSL or allocating arrays per visible
 * cell.
 */
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

/**
 * Keep sequential downsampling averages separate from Hilbert traversal sampling. Text uses actual
 * representative bytes rather than glyphs for fractional averages.
 */
export function paintView(canvas, bytes, entropy, columns, rows, cells, shaders, options) {
	if (options.appearance) {
		const count = columns * rows, factors = new Float64Array(6);
		return paintAppearanceGrid(canvas, columns, rows, options, emit => {
			const text = shaders.includes('hex') || shaders.includes('character');
			for (let i = 0; i < count; i++) {
				const sample = cells || bytes.length > count ? Math.floor(i * bytes.length / count) : i;
				if (sample >= bytes.length) continue;
				let value = bytes[sample], metric = entropy?.[sample] || 0;
				if (!text && !cells && bytes.length > count) {
					const end = Math.floor((i + 1) * bytes.length / count);
					value = metric = 0;
					for (let j = sample; j < end; j++) { value += bytes[j]; metric += entropy?.[j] || 0; }
					value /= end - sample; metric /= end - sample;
				}
				factors[0] = value / 255; factors[1] = metric / 255; factors[2] = sample / Math.max(1, bytes.length - 1);
				factors[4] = ((cells ? cells[i] : i) % columns + 0.5) / columns;
				factors[5] = (Math.floor((cells ? cells[i] : i) / columns) + 0.5) / rows;
				const label = !text ? undefined : shaders.includes('hex') ? bytes[sample].toString(16).padStart(2, '0').toUpperCase()
					: byteCharacter(bytes[sample], options.encoding, options.blankSpaces, options.blankNulls);
				emit(cells ? cells[i] : i, factors, label);
			}
		});
	}
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
/**
 * Use log density relative to the frame peak so rare adjacent pairs remain visible alongside
 * frequent ones.
 */
export function paintDigraph(canvas, counts) {
	let peak = 0;
	for (const count of counts) peak = Math.max(peak, count);
	const values = new Uint8Array(256 * 256);
	const scale = peak ? 255 / Math.log1p(peak) : 0;
	for (let i = 0; i < values.length; i++) values[i] = Math.round(Math.log1p(counts[i]) * scale);
	paintBytes(canvas, values, 256, 256);
}

// Include preparation and painting in the estimate, rather than just output size.
/**
 * Predict structural work, including arbitrary-length FFT overhead, before deciding which thread
 * owns the job. This is calibration input, not a promised runtime.
 */
export function renderCost(job) {
	if (job.configuration) {
		const configuration = job.configuration;
		const appearance = job.appearance || defaultAppearance(job.region, job.shaders, job.frequencyOpacity);
		const used = requiredFactors(configuration, appearance, job.shaders);
		const program = compileRecipes(recipeRoots(configuration, appearance), configuration.recipes);
		const population = configuration.population || 'bytes';
		const available = population === 'bins' ? Math.floor(job.length / 2) + 1 : population === 'pairs' ? Math.min(65536, job.length) : population === 'triples' ? job.length : Math.min(job.length, job.sampleLayout.columns * job.sampleLayout.rows);
		const samples = Math.min(available, configuration.sampleLimit === null ? Infinity : configuration.sampleLimit ?? defaultSampleLimit);
		const statistics = ['entropy', 'byteCount', 'pairCount', 'tripleCount', 'count'].some(name => used.has(name));
		const bytes = statistics || population === 'pairs' || population === 'triples' || ['value','byte1','byte2','byte3','previous'].some(name => used.has(name));
		return (bytes ? job.length * (used.has('entropy') ? 18 : 2) : 0)
			+ samples * (24 + program.nodes.length * 3 + (spaces[configuration.space].length === 3 ? Math.log2(Math.max(1, samples)) * 2 : 0))
			+ job.columns * job.rows * (configuration.backend === 'webgl' ? 4 : 16)
			+ (used.has('phase') || used.has('amplitude') ? fourierCost(job.length) : 0);
	}
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
/**
 * Share the exact dispatcher between UI and worker execution. A configured point job exits early
 * because its geometry already incorporates coordinate mapping.
 * @param {object} cache Exclusive mutable cache owner; never share it across concurrently executing
 *   jobs.
 * @param {function(): boolean} current Supersession guard for async source reads.
 * @returns {Promise<object|null>} Timing/work metrics on success; null for cancelled preparation.
 */
export async function executeRender(canvas, job, cache = {}, current = () => true) {
	let duration = 0, work;
	if (!current()) return null;
	if (job.configuration && job.kind === 'view') return renderPoints(canvas, job, cache, current, { entropyShading, hilbertCells, byteCharacter });
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
		const values = job.appearance ? null : trigraphImage(histogram.counts, job.columns, job.rows, job.rotation, cache.trigraphRaster ||= {}, histogram, job);
		if (job.appearance) paintTrigraphAppearance(canvas, histogram, job, cache.trigraphAppearance ||= {});
		else paintBytes(canvas, values, job.columns, job.rows);
		duration = histogram.duration + performance.now() - started;
		work = (histogram.bytesRead * 3) + histogram.counts.size * 30 + job.columns * job.rows * 8;
	} else if (job.region === 'dft') {
		const started = performance.now();
		let spectrum = matchingSpectrum(job, cache);
		if (!spectrum) {
			const bytes = new Uint8Array(await job.source.slice(job.offset, job.offset + job.length).arrayBuffer());
			if (!current()) return null;
			spectrum = prepareSpectrum(job, cache, bytes);
		}
		const values = fourierImage({ length: job.length }, job.columns, job.rows, spectrum);
		if (job.appearance) paintAppearanceGrid(canvas, job.columns, job.rows, job, emit => {
			const factors = new Float64Array(4);
			for (let i = 0; i < values.length; i++) if (values[i]) {
				factors[0] = (i % job.columns) / Math.max(1, job.columns - 1);
				factors[1] = 1 - Math.floor(i / job.columns) / Math.max(1, job.rows - 1);
				factors[2] = values[i] / 255; emit(i, factors);
			}
		}); else paintBytes(canvas, values, job.columns, job.rows);
		duration = performance.now() - started;
	} else if (job.region === 'digraph') {
		const histogram = await windowCounts(job, cache, 2, current);
		if (!histogram || !current()) return null;
		// Histogram keys store first byte in the high bits; native image rows store
		// the second byte. Transpose only at this compatibility boundary.
		const counts = new Float64Array(65536);
		for (let key = 0; key < counts.length; key++) counts[(key & 255) * 256 + (key >>> 8)] = histogram.counts[key];
		duration = histogram.duration;
		const started = performance.now();
		if (job.appearance) paintAppearanceGrid(canvas, 256, 256, job, emit => {
			const factors = new Float64Array(4);
			for (let i = 0; i < counts.length; i++) if (counts[i]) {
				factors[0] = (i % 256) / 255; factors[1] = Math.floor(i / 256) / 255;
				factors[3] = occurrenceFactor(counts[i]); emit(i, factors);
			}
		}); else paintDigraph(canvas, counts);
		duration += performance.now() - started;
	} else {
		const shaded = job.appearance ? compileAppearance(job.region, job.appearance).needsEntropy : job.shaders.includes('entropy');
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
