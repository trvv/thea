/**
 * Each worker owns one offscreen canvas and its mutable caches. Send serializable jobs, not DOM
 * state or compiled recipe closures.
 * @module render-worker
 */
import { executeRender } from './rendering.js';

const canvas = new OffscreenCanvas(1, 1);
const cache = {};
self.onmessage = async ({ data: { id, job } }) => {
	try {
		const { duration, work } = await executeRender(canvas, job, cache);
		const bitmap = canvas.transferToImageBitmap();
		self.postMessage({ id, bitmap, duration, work }, [bitmap]);
	} catch (error) {
		self.postMessage({ id, error: error.message });
	}
};
