// Exercise the real worker entry point in Bun, substituting its missing canvas API.
import { RenderCanvas } from './render-canvas.js';

globalThis.OffscreenCanvas = RenderCanvas;
const send = self.postMessage.bind(self);
self.postMessage = message => {
	const { bitmap, ...rest } = message;
	if (!bitmap) { send(rest); return; }
	const { width, height, pixels, commands } = bitmap;
	send({ ...rest, bitmap: { width, height, pixels, commands } }, [pixels.buffer]);
};
const queued = [];
self.onmessage = event => queued.push(event);
await import('../render-worker.js');
for (const event of queued) self.onmessage(event);
