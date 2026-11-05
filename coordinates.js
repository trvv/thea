/**
 * Compatibility transforms for optimized presets. These remap images or packed byte triples; recipe
 * spaces instead transform normalized point coordinates.
 * @module coordinates
 */
/**
 * Keep the older coordinate-system API interpretable while the general renderer uses explicit space
 * definitions.
 */
export function coordinateDimensions(region, system = 'cartesian') {
	if (region === 'trigraph') {
		if (system === 'cylindrical') return ['Radius', 'Angle', 'Height'];
		if (system === 'spherical') return ['Radius', 'Azimuth', 'Inclination'];
		return ['X', 'Y', 'Z'];
	}
	return system === 'radial' ? ['Radius', 'Angle'] : ['X', 'Y'];
}

/**
 * Retain preset axis labels for compatibility; they do not define the universal recipe factor pool.
 */
export function sourceDimensions(region) {
	if (region === 'trigraph') return ['Byte 1', 'Byte 2', 'Byte 3'];
	if (region === 'digraph') return ['Byte 1', 'Byte 2'];
	if (region === 'dft') return ['Phase', 'Frequency'];
	return ['Column', 'Row'];
}

const sine = Float64Array.from({ length: 256 }, (_, byte) => Math.sin(byte / 256 * 2 * Math.PI));
const cosine = Float64Array.from({ length: 256 }, (_, byte) => Math.cos(byte / 256 * 2 * Math.PI));
const inclinationSine = Float64Array.from({ length: 256 }, (_, byte) => Math.sin(byte / 255 * Math.PI));
const inclinationCosine = Float64Array.from({ length: 256 }, (_, byte) => Math.cos(byte / 255 * Math.PI));

// Coordinates are normalized to the same unit volume before camera projection.
/**
 * Compile byte-axis permutations before the hot loop and use angle lookup tables; these inputs are
 * packed 8-bit triples, not arbitrary recipe scalars.
 */
export function spatialTransform(system = 'cartesian', axes = [0, 1, 2]) {
	const shifts = axes.map(axis => (2 - axis) * 8);
	return (triple, output) => {
		const a = (triple >>> shifts[0]) & 255, b = (triple >>> shifts[1]) & 255, c = (triple >>> shifts[2]) & 255;
		if (system === 'cylindrical') {
			output[0] = a / 255 * cosine[b];
			output[1] = c / 127.5 - 1;
			output[2] = a / 255 * sine[b];
		} else if (system === 'spherical') {
			const radius = a / 255;
			output[0] = radius * inclinationSine[c] * cosine[b];
			output[1] = radius * inclinationCosine[c];
			output[2] = radius * inclinationSine[c] * sine[b];
		} else {
			output[0] = a / 127.5 - 1; output[1] = b / 127.5 - 1; output[2] = c / 127.5 - 1;
		}
	};
}

/**
 * Inverse-map target pixels to avoid holes from forward splatting. DFT phase centering and vertical
 * frequency orientation require explicit semantics.
 */
export function remapImage(source, sourceWidth, sourceHeight, width, height, system = 'cartesian', axes = [0, 1], semantics = {}) {
	const result = new Uint8ClampedArray(width * height * 4);
	const radius = Math.min(width, height) / 2;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		let first = (x + 0.5) / width, second = (y + 0.5) / height;
		const target = (y * width + x) * 4;
		if (system === 'radial') {
			const dx = x + 0.5 - width / 2, dy = height / 2 - y - 0.5;
			first = Math.hypot(dx, dy) / radius;
			if (first > 1) { result[target + 3] = 255; continue; }
			second = ((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1;
		}
		const u = axes[0] === 0 ? first : second, v = axes[0] === 0 ? second : first;
		const sourceU = semantics.phase && system === 'radial' && axes[1] === 0 ? (u + 0.5) % 1 : u;
		const sourceV = semantics.flipY ? 1 - v : v;
		const sx = Math.min(sourceWidth - 1, Math.floor(sourceU * sourceWidth));
		const sy = Math.min(sourceHeight - 1, Math.floor(sourceV * sourceHeight));
		const index = (sy * sourceWidth + sx) * 4;
		result[target] = source[index]; result[target + 1] = source[index + 1];
		result[target + 2] = source[index + 2]; result[target + 3] = source[index + 3];
	}
	return result;
}

/**
 * Apply legacy 2D transforms once, after preset rendering. General recipe jobs already have
 * positioned points and must not pass through this remapper.
 */
export function applyImageCoordinates(canvas, job) {
	if (job.region === 'trigraph' || job.kind !== 'view') return;
	const system = job.coordinateSystem || 'cartesian', axes = job.axes || [0, 1];
	if (system === 'cartesian' && axes[0] === 0) return;
	const context = canvas.getContext('2d'), sourceWidth = canvas.width, sourceHeight = canvas.height;
	const source = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
	const scale = Math.min(job.scale || 1, 1024 / Math.max(1, job.width || sourceWidth, job.height || sourceHeight));
	const width = system === 'radial' ? Math.max(1, Math.round((job.width || sourceWidth) * scale)) : sourceWidth;
	const height = system === 'radial' ? Math.max(1, Math.round((job.height || sourceHeight) * scale)) : sourceHeight;
	const data = remapImage(source, sourceWidth, sourceHeight, width, height, system, axes, job.region === 'dft' ? { phase: true, flipY: true } : {});
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	const image = context.createImageData(width, height);
	image.data.set(data);
	context.putImageData(image, 0, 0);
}
