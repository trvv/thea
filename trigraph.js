import { spatialTransform } from './coordinates.js';

// Cache the histogram independently of the camera so dragging only reprojects it.
function rangeDifference(start, end, otherStart, otherEnd) {
	const ranges = [];
	if (start < Math.min(end, otherStart)) ranges.push([start, Math.min(end, otherStart)]);
	if (Math.max(start, otherEnd) < end) ranges.push([Math.max(start, otherEnd), end]);
	return ranges;
}

export async function trigraphCounts(job, cache, current = () => true) {
	const cached = cache.trigraph;
	const sameSource = cached && (job.sourceId === undefined ? cached.source === job.source : cached.sourceId === job.sourceId);
	if (sameSource && cached.offset === job.offset && cached.length === job.length) {
		return { counts: cached.counts, revision: cached.revision, changed: cached.changed, duration: 0, read: false, bytesRead: 0 };
	}
	const oldEnd = cached ? cached.offset + Math.max(0, cached.length - 2) : 0;
	const end = job.offset + Math.max(0, job.length - 2);
	const overlap = sameSource ? Math.max(0, Math.min(oldEnd, end) - Math.max(cached.offset, job.offset)) : 0;
	const changed = cached ? oldEnd - cached.offset + end - job.offset - 2 * overlap : Infinity;
	// For overlapping windows, remove outgoing triples and add incoming triples.
	// Read all changes before mutation so a superseded request cannot corrupt the cache.
	if (overlap && changed < end - job.offset && changed <= 1048576) {
		const changes = [];
		let bytesRead = 0;
		for (const [ranges, delta] of [
			[rangeDifference(cached.offset, oldEnd, job.offset, end), -1],
			[rangeDifference(job.offset, end, cached.offset, oldEnd), 1]
		]) for (const [start, limit] of ranges) {
			for (let offset = start; offset < limit; offset += 65536) {
				const bytes = new Uint8Array(await job.source.slice(offset, Math.min(limit, offset + 65536) + 2).arrayBuffer());
				if (!current()) return null;
				changes.push({ bytes, delta });
				bytesRead += bytes.length;
			}
		}
		if (!current()) return null;
		const started = performance.now();
		const changedKeys = new Set();
		for (const { bytes, delta } of changes) for (let i = 0; i + 2 < bytes.length; i++) {
			const triple = bytes[i] * 65536 + bytes[i + 1] * 256 + bytes[i + 2];
			changedKeys.add(triple);
			const count = (cached.counts.get(triple) || 0) + delta;
			if (count) cached.counts.set(triple, count);
			else cached.counts.delete(triple);
		}
		Object.assign(cached, { source: job.source, offset: job.offset, length: job.length, revision: cached.revision + 1, changed: changedKeys });
		return { counts: cached.counts, revision: cached.revision, changed: changedKeys, duration: performance.now() - started, read: true, bytesRead };
	}
	const counts = new Map();
	let previous = 0, seen = 0, duration = 0;
	for (let offset = job.offset; offset < job.offset + job.length;) {
		const bytes = new Uint8Array(await job.source.slice(offset, Math.min(offset + 65536, job.offset + job.length)).arrayBuffer());
		if (!current()) return null;
		if (!bytes.length) throw new Error('Byte source ended before its declared size.');
		const started = performance.now();
		for (const byte of bytes) {
			previous = ((previous << 8) | byte) & 0xffffff;
			if (seen === 2) counts.set(previous, (counts.get(previous) || 0) + 1);
			else seen++;
		}
		duration += performance.now() - started;
		offset += bytes.length;
	}
	if (!current()) return null;
	cache.trigraph = { source: job.source, sourceId: job.sourceId, offset: job.offset, length: job.length, counts, revision: 1, changed: null };
	return { counts, revision: 1, changed: null, duration, read: true, bytesRead: job.length };
}

function worldProjection(width, height, rotation = { yaw: -0.6, pitch: 0.45 }) {
	const cy = Math.cos(rotation.yaw), sy = Math.sin(rotation.yaw);
	const cp = Math.cos(rotation.pitch), sp = Math.sin(rotation.pitch);
	const focal = Math.max(0, Math.min(width - 1, height - 1)) * 0.8;
	return (x, y, z) => {
		const rx = x * cy + z * sy, rz = z * cy - x * sy;
		const ry = y * cp - rz * sp, depth = y * sp + rz * cp;
		return { x: (width - 1) / 2 + rx * focal / (3.5 - depth),
			y: (height - 1) / 2 - ry * focal / (3.5 - depth), z: depth };
	};
}

export function cubeProjection(width, height, rotation, options = {}) {
	const project = worldProjection(width, height, rotation);
	const transform = spatialTransform(options.coordinateSystem, options.axes);
	const position = new Float64Array(3);
	return (first, second, third) => {
		transform(first * 65536 + second * 256 + third, position);
		return project(position[0], position[1], position[2]);
	};
}

const coordinates = Float64Array.from({ length: 256 }, (_, value) => value / 127.5 - 1);

export const projectedPointSize = depth => 1.5 * 3.5 / (3.5 - depth);

const TILE_SIZE = 2;

function growPoints(points, size) {
	if (size <= points.capacity) return;
	const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(size)));
	for (const [name, Type, stride] of [
		['keys', Uint32Array, 1], ['weights', Float64Array, 1], ['projected', Float64Array, 4],
		['next', Int32Array, 1], ['previous', Int32Array, 1], ['bin', Int32Array, 1]
	]) {
		const buffer = new Type(capacity * stride);
		if (Type === Int32Array) buffer.fill(-1);
		if (points[name]) buffer.set(points[name]);
		points[name] = buffer;
	}
	points.capacity = capacity;
}

// Stable dense slots and spatial bins make small window changes proportional
// to the visible changes, rather than to every point in the selected buffer.
function updatePoints(counts, scratch, histogram, width, height, rotation, captureOpacity, options) {
	let points = scratch.points;
	const revision = histogram?.revision;
	const rebuild = !points || points.source !== counts || revision === undefined
		|| (points.revision !== revision && points.revision + 1 !== revision);
	const { yaw, pitch } = rotation || { yaw: -0.6, pitch: 0.45 };
	const system = options.coordinateSystem || 'cartesian', axes = options.axes || [0, 1, 2];
	const pointScale = options.pointScale ?? 1;
	const camera = `${width}/${height}/${yaw}/${pitch}/${system}/${axes.join()}/${pointScale}`;
	const shifts = axes.map(axis => (2 - axis) * 8);
	const transform = spatialTransform(system, axes), position = new Float64Array(3);
	const full = rebuild || points.camera !== camera;
	const dirty = new Set(), opacityChanges = [];
	const tileColumns = Math.ceil(width / TILE_SIZE), tileRows = Math.ceil(height / TILE_SIZE);
	const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
	const focal = Math.max(0, Math.min(width - 1, height - 1)) * 0.8;
	let projectedCount = 0;
	const project = index => {
		const triple = points.keys[index];
		let x, y, z;
		if (system === 'cartesian') {
			x = coordinates[(triple >>> shifts[0]) & 255]; y = coordinates[(triple >>> shifts[1]) & 255]; z = coordinates[(triple >>> shifts[2]) & 255];
		} else { transform(triple, position); [x, y, z] = position; }
		const rx = x * cy + z * sy, rz = z * cy - x * sy;
		const ry = y * cp - rz * sp, depth = y * sp + rz * cp;
		const offset = index * 4;
		points.projected[offset] = (width - 1) / 2 + rx * focal / (3.5 - depth);
		points.projected[offset + 1] = (height - 1) / 2 - ry * focal / (3.5 - depth);
		points.projected[offset + 2] = depth;
		points.projected[offset + 3] = projectedPointSize(depth) * pointScale / 2;
		projectedCount++;
	};
	const link = index => {
		const x = Math.max(0, Math.min(tileColumns - 1, Math.floor(points.projected[index * 4] / TILE_SIZE)));
		const y = Math.max(0, Math.min(tileRows - 1, Math.floor(points.projected[index * 4 + 1] / TILE_SIZE)));
		const bin = y * tileColumns + x, next = points.heads[bin];
		points.bin[index] = bin;
		points.previous[index] = -1;
		points.next[index] = next;
		if (next >= 0) points.previous[next] = index;
		points.heads[bin] = index;
	};
	const unlink = index => {
		const bin = points.bin[index];
		if (bin < 0) return;
		const previous = points.previous[index], next = points.next[index];
		if (previous < 0) points.heads[bin] = next;
		else points.next[previous] = next;
		if (next >= 0) points.previous[next] = previous;
	};
	const visit = (index, operation, replacement) => {
		if (full || captureOpacity || !scratch.opaqueValid) return;
		const p = index * 4, px = points.projected[p], py = points.projected[p + 1];
		const distance = points.projected[p + 2], half = points.projected[p + 3];
		const x0 = Math.max(0, Math.floor(px - half + 0.5)), x1 = Math.min(width - 1, Math.ceil(px + half + 0.5) - 1);
		const y0 = Math.max(0, Math.floor(py - half + 0.5)), y1 = Math.min(height - 1, Math.ceil(py + half + 0.5) - 1);
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
			const pixel = y * width + x;
			for (let sample = 0; sample < 4; sample++) {
				if (operation === 'add') {
					const sx = x + (sample & 1 ? 0.25 : -0.25), sy = y + (sample & 2 ? 0.25 : -0.25);
					if (sx < px - half || sx >= px + half || sy < py - half || sy >= py + half) continue;
				}
				const subpixel = pixel * 4 + sample;
				if (operation === 'move') {
					if (scratch.owners[subpixel] === index + 1) scratch.owners[subpixel] = replacement + 1;
				} else if (operation === 'add' ? distance >= scratch.depth[subpixel] : scratch.owners[subpixel] === index + 1) {
					dirty.add(Math.floor(y / TILE_SIZE) * tileColumns + Math.floor(x / TILE_SIZE));
					break;
				}
			}
		}
	};
	const opacityChange = (index, before, after) => {
		if (!captureOpacity || full || before === after) return;
		const p = index * 4;
		opacityChanges.push([points.projected[p], points.projected[p + 1], points.projected[p + 3], before, after]);
	};
	const update = (count, key) => {
		let index = points.indices.get(key);
		if (!count) {
			if (index === undefined) return;
			opacityChange(index, points.weights[index], 0);
			visit(index, 'remove');
			unlink(index);
			const last = --points.size;
			if (index !== last) {
				visit(last, 'move', index);
				points.keys[index] = points.keys[last];
				points.weights[index] = points.weights[last];
				points.projected.copyWithin(index * 4, last * 4, last * 4 + 4);
				const previous = points.previous[last], next = points.next[last], bin = points.bin[last];
				points.previous[index] = previous; points.next[index] = next; points.bin[index] = bin;
				if (bin >= 0) {
					if (previous < 0) points.heads[bin] = index;
					else points.next[previous] = index;
					if (next >= 0) points.previous[next] = index;
				}
				points.indices.set(points.keys[index], index);
			}
			points.indices.delete(key);
			return;
		}
		const before = index === undefined ? 0 : points.weights[index];
		if (index === undefined) {
			index = points.size++;
			growPoints(points, points.size);
			points.keys[index] = key;
			points.bin[index] = -1;
			points.indices.set(key, index);
			if (!full) { project(index); link(index); visit(index, 'add'); }
		}
		opacityChange(index, before, count);
		points.weights[index] = count;
	};
	if (rebuild) {
		points = scratch.points = { source: counts, size: 0, capacity: 0, indices: new Map() };
		growPoints(points, counts.size);
		counts.forEach(update);
	} else if (points.revision !== revision) {
		for (const key of histogram.changed) update(counts.get(key) || 0, key);
	}
	if (full) {
		points.heads = new Int32Array(tileColumns * tileRows).fill(-1);
		for (let i = 0; i < points.size; i++) { project(i); link(i); }
		points.camera = camera;
	}
	Object.assign(points, { revision, dirty, full, tileColumns, tileRows, projectedCount, opacityChanges, binRadius: Math.max(1, Math.ceil((projectedPointSize(Math.sqrt(3)) * pointScale / 2 + 0.25) / TILE_SIZE)) });
	return points;
}

function rasterPoint(points, index, scratch, x0, y0, x1, y1) {
	const { width, owners, depth } = scratch;
	const p = index * 4, px = points.projected[p], py = points.projected[p + 1];
	const distance = points.projected[p + 2], half = points.projected[p + 3];
	const left = px - half, right = px + half, top = py - half, bottom = py + half;
	x0 = Math.max(x0, Math.floor(left + 0.5)); x1 = Math.min(x1, Math.ceil(right + 0.5) - 1);
	y0 = Math.max(y0, Math.floor(top + 0.5)); y1 = Math.min(y1, Math.ceil(bottom + 0.5) - 1);
	if (x0 > x1 || y0 > y1) return;
	for (let y = y0; y <= y1; y++) {
		const lowY = y - 0.25 >= top && y - 0.25 < bottom;
		const highY = y + 0.25 >= top && y + 0.25 < bottom;
		if (!lowY && !highY) continue;
		for (let x = x0; x <= x1; x++) {
			const lowX = x - 0.25 >= left && x - 0.25 < right;
			const highX = x + 0.25 >= left && x + 0.25 < right;
			const mask = (lowX && lowY ? 1 : 0) | (highX && lowY ? 2 : 0)
				| (lowX && highY ? 4 : 0) | (highX && highY ? 8 : 0);
			for (let sample = 0; sample < 4; sample++) {
				if (!(mask & (1 << sample))) continue;
				const pixel = (y * width + x) * 4 + sample;
				if (distance < depth[pixel]) continue;
				const owner = owners[pixel];
				if (distance === depth[pixel] && owner && points.keys[owner - 1] > points.keys[index]) continue;
				depth[pixel] = distance;
				owners[pixel] = index + 1;
			}
		}
	}
	scratch.rasterizedCount++;
}

function drawWireframe(background, width, height, rotation, options) {
	background.fill(0);
	const project = worldProjection(width, height, rotation);
	const line = (first, second) => {
		const from = project(...first), to = project(...second);
		const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))));
		for (let step = 0; step <= steps; step++) {
			const x = Math.round(from.x + (to.x - from.x) * step / steps), y = Math.round(from.y + (to.y - from.y) * step / steps);
			if (x >= 0 && x < width && y >= 0 && y < height) background[y * width + x] = 48;
		}
	};
	const circle = point => {
		for (let i = 0; i < 64; i++) line(point(i * Math.PI / 32), point((i + 1) * Math.PI / 32));
	};
	if (options.coordinateSystem === 'cylindrical') {
		for (const height of [-1, 1]) circle(angle => [Math.cos(angle), height, Math.sin(angle)]);
		for (let i = 0; i < 4; i++) {
			const x = Math.cos(i * Math.PI / 2), z = Math.sin(i * Math.PI / 2);
			line([x, -1, z], [x, 1, z]);
		}
	} else if (options.coordinateSystem === 'spherical') {
		circle(angle => [Math.cos(angle), Math.sin(angle), 0]);
		circle(angle => [Math.cos(angle), 0, Math.sin(angle)]);
		circle(angle => [0, Math.cos(angle), Math.sin(angle)]);
	} else {
		const corners = Array.from({ length: 8 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
		for (let i = 0; i < 8; i++) for (const axis of [1, 2, 4]) if (!(i & axis)) line(corners[i], corners[i | axis]);
	}
}

export function trigraphImage(counts, width, height, rotation, scratch = {}, histogram, options = {}) {
	const opacity = options.frequencyOpacity || false;
	if (scratch.width !== width || scratch.height !== height) {
		Object.assign(scratch, { width, height, values: new Uint8Array(width * height),
			background: new Uint8Array(width * height), owners: new Uint32Array(width * height * 4),
			depth: new Float64Array(width * height * 4).fill(-Infinity), opaqueValid: false, opacityValid: false });
	}
	const points = updatePoints(counts, scratch, histogram, width, height, rotation, opacity, options);
	const { values, background, owners, depth } = scratch;
	if (opacity) {
		if (points.full || !scratch.opacityValid) drawWireframe(background, width, height, rotation, options);
		return opacityImage(points, scratch);
	}
	scratch.opacityValid = false;
	const full = !scratch.opaqueValid || points.full || points.dirty.size > points.heads.length / 8;
	scratch.rasterizedCount = 0;
	if (full) {
		owners.fill(0); depth.fill(-Infinity);
		drawWireframe(background, width, height, rotation, options);
		for (let i = 0; i < points.size; i++) rasterPoint(points, i, scratch, 0, 0, width - 1, height - 1);
	} else for (const tile of points.dirty) {
		const tx = tile % points.tileColumns, ty = Math.floor(tile / points.tileColumns);
		const x0 = tx * TILE_SIZE, y0 = ty * TILE_SIZE;
		const x1 = Math.min(width - 1, x0 + TILE_SIZE - 1), y1 = Math.min(height - 1, y0 + TILE_SIZE - 1);
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
			const pixel = (y * width + x) * 4;
			for (let sample = 0; sample < 4; sample++) { owners[pixel + sample] = 0; depth[pixel + sample] = -Infinity; }
		}
		// Include every center bin that can overlap the tile at this device resolution.
		for (let yy = Math.max(0, ty - points.binRadius); yy <= Math.min(points.tileRows - 1, ty + points.binRadius); yy++) {
			for (let xx = Math.max(0, tx - points.binRadius); xx <= Math.min(points.tileColumns - 1, tx + points.binRadius); xx++) {
				for (let i = points.heads[yy * points.tileColumns + xx]; i >= 0; i = points.next[i]) rasterPoint(points, i, scratch, x0, y0, x1, y1);
			}
		}
	}
	let peak = 0;
	for (let i = 0; i < points.size; i++) peak = Math.max(peak, points.weights[i]);
	const scale = peak ? 191 / Math.log1p(peak) : 0, limit = Math.min(peak, points.size, 1024);
	const shades = new Uint8Array(limit + 1);
	for (let count = 1; count <= limit; count++) shades[count] = Math.round(64 + Math.log1p(count) * scale);
	if (!points.shades || points.shades.length < points.capacity) points.shades = new Uint8Array(points.capacity);
	for (let i = 0; i < points.size; i++) {
		const count = points.weights[i];
		points.shades[i] = count <= limit ? shades[count] : Math.round(64 + Math.log1p(count) * scale);
	}
	// Four independent depth samples retain the particles behind soft edges;
	// fading a single nearest owner against black would create dark outlines.
	for (let pixel = 0; pixel < values.length; pixel++) {
		const offset = pixel * 4, bg = background[pixel];
		const a = owners[offset], b = owners[offset + 1], c = owners[offset + 2], d = owners[offset + 3];
		const sum = (a ? points.shades[a - 1] : bg) + (b ? points.shades[b - 1] : bg)
			+ (c ? points.shades[c - 1] : bg) + (d ? points.shades[d - 1] : bg);
		values[pixel] = Math.round(sum / 4);
	}
	scratch.opaqueValid = true;
	return values;
}

// For white particles, source-over opacity is order independent:
// transmittance = product(1 - alpha). Optical depths add, so overlapping
// selections can update just the changed particles without depth sorting.
function accumulateOpacity(scratch, px, py, half, contribution, incremental) {
	const { width, height, opticalDepth, transmittance } = scratch;
	const left = px - half, right = px + half, top = py - half, bottom = py + half;
	const x0 = Math.max(0, Math.floor(left + 0.5)), x1 = Math.min(width - 1, Math.ceil(right + 0.5) - 1);
	const y0 = Math.max(0, Math.floor(top + 0.5)), y1 = Math.min(height - 1, Math.ceil(bottom + 0.5) - 1);
	for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
		for (let sample = 0; sample < 4; sample++) {
			const sx = x + (sample & 1 ? 0.25 : -0.25), sy = y + (sample & 2 ? 0.25 : -0.25);
			if (sx < left || sx >= right || sy < top || sy >= bottom) continue;
			const pixel = (y * width + x) * 4 + sample;
			opticalDepth[pixel] += contribution;
			if (incremental) transmittance[pixel] = Math.exp(-Math.max(0, opticalDepth[pixel]));
		}
	}
}

function opacityImage(points, scratch) {
	const samples = scratch.width * scratch.height * 4;
	if (!scratch.opticalDepth || scratch.opticalDepth.length !== samples) {
		scratch.opticalDepth = new Float64Array(samples);
		scratch.transmittance = new Float64Array(samples);
		scratch.opacityValid = false;
	}
	const { opticalDepth, transmittance, values, background } = scratch;
	if (points.full || !scratch.opacityValid) {
		opticalDepth.fill(0);
		for (let i = 0; i < points.size; i++) {
			const p = i * 4;
			accumulateOpacity(scratch, points.projected[p], points.projected[p + 1], points.projected[p + 3], 0.25 * Math.log1p(points.weights[i]), false);
		}
		for (let i = 0; i < samples; i++) transmittance[i] = Math.exp(-opticalDepth[i]);
	} else for (const [x, y, half, before, after] of points.opacityChanges) {
		const delta = 0.25 * (Math.log1p(after) - Math.log1p(before));
		accumulateOpacity(scratch, x, y, half, delta, true);
	}
	for (let i = 0; i < values.length; i++) {
		const p = i * 4;
		const transmission = (transmittance[p] + transmittance[p + 1] + transmittance[p + 2] + transmittance[p + 3]) / 4;
		values[i] = Math.round(255 - (255 - background[i]) * transmission);
	}
	scratch.opacityValid = true;
	scratch.opaqueValid = false;
	return values;
}
