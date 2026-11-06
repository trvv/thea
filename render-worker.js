/**
 * Each worker owns one offscreen canvas and its mutable caches. Send serializable jobs, not DOM
 * state or compiled recipe closures.
 * @module render-worker
 */
import { inspectPoint } from "./point-inspection.js";
import { executeRender } from "./rendering.js";

const canvas = new OffscreenCanvas(1, 1);
const cache = {};
let canceledThrough = 0;
// Inspection can await source reads too. Serialize it with rendering so mutable provider caches
// never have two concurrent owners. Only the clicked point's description crosses the thread boundary.
async function process(data) {
  const { id, job, inspection, x, y } = data;
  try {
    if (inspection !== undefined) {
      const point = await inspectPoint(job, cache, x, y);
      self.postMessage({ inspection, point });
      return;
    }
    const result = await executeRender(
      canvas,
      job,
      cache,
      () => id > canceledThrough,
    );
    if (!result) {
      self.postMessage({ id, canceled: true });
      return;
    }
    const { duration, work, dimensions, timings, reused, diagnostics } = result;
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage(
      { id, bitmap, duration, work, dimensions, timings, reused, diagnostics },
      [bitmap],
    );
  } catch (error) {
    self.postMessage(
      inspection === undefined
        ? { id, error: error.message, jobError: true }
        : { inspection, error: error.message },
    );
  }
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.cancel !== undefined) {
    canceledThrough = Math.max(canceledThrough, data.cancel);
    return;
  }
  queue = queue.then(() => process(data));
};
