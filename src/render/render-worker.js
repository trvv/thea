/**
 * Each worker owns one offscreen canvas and its mutable caches. Send serializable jobs, not DOM
 * state or compiled recipe closures.
 * @module render-worker
 */
import { inspectPoint } from "../inspection/point-inspection.js";
import { executeRender } from "./rendering.js";

import { sharedAnalysisFor } from "../data/shared-analysis.js";
const clients = new Map();
const sources = new Map();
function release(state) {
  const source = sources.get(state.sourceId);
  if (source && !--source.users) sources.delete(state.sourceId);
  state.sourceId = undefined;
}
function bindSource(state, job) {
  const identity = job.sharedSourceId;
  if (identity === undefined) return;
  if (state.sourceId !== identity) {
    release(state);
    if (!sources.has(identity))
      sources.set(identity, { source: job.source, users: 0 });
    sources.get(identity).users++;
    state.sourceId = identity;
  }
  job.source = sources.get(identity).source;
  state.cache.sharedAnalysis = sharedAnalysisFor(job.source);
}
// Inspection can await source reads too. Serialize it with rendering so mutable provider caches
// never have two concurrent owners. Only the clicked point's description crosses the thread boundary.
async function process(data, state) {
  if (state.disconnected) return;
  const { canvas, cache } = state;
  const post = (message, transfer = []) =>
    self.postMessage({ ...message, channel: data.channel }, transfer);
  const { id, job, inspection, x, y } = data;
  try {
    bindSource(state, job);
    if (inspection !== undefined) {
      const point = await inspectPoint(
        job,
        cache,
        x,
        y,
        () => !state.disconnected,
      );
      post({ inspection, point });
      return;
    }
    const result = await executeRender(
      canvas,
      job,
      cache,
      () => !state.disconnected && id > state.canceledThrough,
    );
    if (!result) {
      post({ id, canceled: true });
      return;
    }
    const {
      duration,
      work,
      dimensions,
      timings,
      reused,
      diagnostics,
      density,
    } = result;
    const bitmap = canvas.transferToImageBitmap();
    post(
      {
        id,
        bitmap,
        duration,
        work,
        dimensions,
        timings,
        reused,
        diagnostics,
        density,
      },
      [bitmap],
    );
  } catch (error) {
    post(
      inspection === undefined
        ? { id, error: error.message, jobError: true }
        : { inspection, error: error.message },
    );
  }
}
self.onmessage = ({ data }) => {
  const channel = data.channel ?? 0;
  let state = clients.get(channel);
  if (data.disconnect) {
    if (state) {
      state.disconnected = true;
      state.cache.pointGPU?.dispose?.();
      state.cache.pointCompute?.dispose?.();
      release(state);
      clients.delete(channel);
    }
    return;
  }
  if (!state) {
    state = {
      canvas: new OffscreenCanvas(1, 1),
      cache: {},
      canceledThrough: 0,
      queue: Promise.resolve(),
    };
    clients.set(channel, state);
  }
  if (data.cancel !== undefined) {
    state.canceledThrough = Math.max(state.canceledThrough, data.cancel);
    return;
  }
  state.queue = state.queue.then(() => process(data, state));
};
