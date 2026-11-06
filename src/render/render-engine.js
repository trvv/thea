import { sharedRenderWorker, sharedSourceId } from "./render-worker-hub.js";
import { sharedAnalysisFor } from "../data/shared-analysis.js";
/**
 * Per-canvas scheduling and presentation. Worker ownership and monotonic frame IDs protect both
 * responsiveness and cache locality.
 * @module render-engine
 * @see docs/rendering.md
 */
import {
  settingsKey,
  preparationKey,
  presentationKey,
} from "./render-identity.js";
import { resolveViewJob, spaces } from "../recipes/point-configuration.js";
import { inspectPoint } from "../inspection/point-inspection.js";
import { executeRender, renderCost } from "./rendering.js";

/**
 * A serializable snapshot, not live component state. Optional fields depend on
 * whether the job is an overview or a configured point view.
 * @typedef {object} RenderJob
 * @property {'view'|'bar'} kind
 * @property {Blob} source Immutable bytes; sourceId identifies them across clones.
 * @property {number} [sourceId] Engine-local identity; never a process-wide key.
 * @property {number} [offset=0] Byte start relative to source.
 * @property {number} [length] Selected/scope byte count, not an end offset.
 * @property {string} [region] Compatibility preset name.
 * @property {object} [configuration] Resolved point configuration; preset defaults are materialized before dispatch.
 * @property {{columns:number, rows:number}} [sampleLayout] Sample budget and aspect hint.
 * @property {number} [columns] Output raster width.
 * @property {number} [rows] Output raster height.
 * @property {number} [width] CSS view width; bar jobs use overview raster width.
 * @property {number} [height] CSS view height; bar jobs use overview raster height.
 * @property {number} [scale=1] Device-pixel ratio for view rendering.
 * @property {number} [pointScale=1] DPR times quality scale for particle footprint.
 * @property {object} [appearance] Scalar mappings or recipe expressions.
 * @property {string[]} [shaders] Compatibility color/text flags, not GPU programs.
 * @property {{yaw:number, pitch:number}} [rotation] Camera angles in radians.
 * @property {boolean} [diagnostics] Opt in to serializable provider measurements, without page UI.
 * @property {boolean} [progressive] Allow compatible ordered intermediate frames.
 * @property {string} [appearanceKey] Engine-generated mapping/presentation identity.
 * @see docs/rendering.md
 */

/**
 * Own caches per canvas: source IDs are only unique within this engine, and a worker cannot borrow
 * another canvas's mutable raster state.
 */
export class RenderEngine {
  // Spend at most half a 60 Hz frame on predicted UI-thread rendering.
  /**
   * Route only predicted expensive work away from the UI thread; injectable workers make routing and
   * stale-frame rules testable.
   */
  constructor(canvas, { budget = 8, workerFactory } = {}) {
    this.canvas = canvas;
    this.budget = budget;
    this.workerFactory = workerFactory || sharedRenderWorker;
    this.supported =
      Boolean(workerFactory) ||
      (typeof Worker === "function" &&
        typeof OffscreenCanvas === "function" &&
        typeof OffscreenCanvas.prototype.transferToImageBitmap === "function");
    this.rates = new Map();
    this.offloaded = new Set();
    this.cache = {};
    this.version = 0;
    this.presented = 0;
    this.sourceIds = new WeakMap();
    this.sourceSerial = 0;
    this.statistics = {
      requested: 0,
      started: 0,
      completed: 0,
      presented: 0,
      superseded: 0,
      failed: 0,
      canceled: 0,
      cancelRequested: 0,
    };
  }

  /**
   * Keep calibration and offloading affinity specific enough that text, scatter, and opacity costs
   * do not train one universal estimate.
   */
  key(job) {
    if (job.kind === "bar") return "bar";
    job = resolveViewJob(job);
    return `points-${job.configuration.space}-${job.configuration.backend}-${job.shaders.some((shader) => shader === "character" || shader === "hex") ? "text" : "marks"}`;
  }

  /**
   * Multiply structural work by observed cost; source length alone misses FFT working size and
   * output-raster cost.
   */
  estimate(job) {
    return renderCost(job) * (this.rates.get(this.key(job)) || 0.00002);
  }

  /**
   * Smooth bounded observations so a cold cache or tiny frame cannot destabilize future routing.
   */
  measure(job, duration, work = renderCost(job)) {
    const cost = work;
    if (cost < 4096 || !Number.isFinite(duration)) return;
    const key = this.key(job);
    const previous = this.rates.get(key) || 0.00002;
    const observed = Math.max(0.000002, Math.min(0.002, duration / cost));
    this.rates.set(key, previous * 0.8 + observed * 0.2);
  }

  /**
   * Measure completion from job start, excluding pending-queue wait, and defer feedback to avoid
   * re-entering presentation.
   */
  reportFrame(request, metrics) {
    const frame = {
      job: request.job,
      duration: performance.now() - request.started,
      dimensions: metrics?.dimensions,
      timings: metrics?.timings,
      reused: metrics?.reused,
      ...(metrics?.diagnostics
        ? {
            diagnostics: {
              ...metrics.diagnostics,
              engine: {
                ...this.statistics,
                queueMilliseconds: request.started - request.enqueued,
                renderMilliseconds: metrics.duration ?? null,
                presentationMilliseconds:
                  request.presentationMilliseconds ?? null,
                requestToPresentationMilliseconds:
                  performance.now() - request.enqueued,
              },
            },
          }
        : {}),
    };
    queueMicrotask(() => this.onFrame?.(frame));
  }

  /**
   * Allow ordered intermediate scrolling frames to avoid starvation, but reject different sources,
   * mappings, raster sizes, and already-presented IDs.
   */
  canPresent(request) {
    if (request.id <= this.presented) return false;
    if (request.id === this.version) return true;
    const latest = this.latest;
    // During scrolling, present completed frames in order instead of waiting
    // indefinitely for a request with no newer pointer event behind it.
    const compatible =
      latest &&
      request.job.appearanceKey === latest.appearanceKey &&
      (request.job.presentationKey ?? presentationKey(request.job)) ===
        (latest.presentationKey ?? presentationKey(latest));
    if (
      compatible &&
      request.job.progressive &&
      latest.progressive &&
      request.job.kind === "view"
    )
      return true;
    return (
      compatible &&
      request.job.kind === "view" &&
      spaces[request.job.configuration?.space]?.length === 3 &&
      request.job.offset === latest.offset &&
      request.job.length === latest.length
    );
  }

  /**
   * Assign stable source IDs before structured cloning and replace pending requests instead of
   * building a backlog.
   * @returns {Promise<boolean>} True when a frame was presented; superseded jobs resolve false.
   */
  render(job) {
    if (!this.sourceIds.has(job.source))
      this.sourceIds.set(job.source, ++this.sourceSerial);
    // Own mutable settings so callers cannot change a local job after dispatch;
    // Blob itself is immutable and keeps its identity for providers.
    const { source, ...settings } = job;
    job = resolveViewJob({
      ...structuredClone(settings),
      source,
      sourceId: this.sourceIds.get(source),
      sharedSourceId: sharedSourceId(source),
    });
    job.appearanceKey = settingsKey(job);
    job.preparationKey = preparationKey(job);
    job.presentationKey = presentationKey(job);
    const id = ++this.version;
    this.latest = job;
    if (this.active && !this.canPresent(this.active)) {
      this.statistics.cancelRequested++;
      this.worker?.postMessage({ cancel: this.active.id });
    }
    // One running worker job and one replaceable pending job per canvas.
    if (this.pending) this.statistics.superseded++;
    this.pending?.resolve(false);
    this.pending = null;
    return new Promise((resolve, reject) => {
      this.statistics.requested++;
      const request = { id, job, resolve, reject, enqueued: performance.now() };
      if (
        this.supported &&
        (this.estimate(job) >= this.budget || this.offloaded.has(this.key(job)))
      ) {
        if (this.active) this.pending = request;
        else this.start(request);
      } else this.local(request);
    });
  }

  /**
   * Check request currency after awaited source reads so an obsolete local job cannot paint over
   * newer state.
   */
  async local(request) {
    request.started = performance.now();
    this.statistics.started++;
    this.cache.sharedAnalysis = sharedAnalysisFor(request.job.source);
    try {
      const result = await executeRender(
        this.canvas,
        request.job,
        this.cache,
        () => request.id === this.version,
      );
      this.statistics.completed++;
      if (!result) this.statistics.canceled++;
      if (result) {
        this.statistics.presented++;
        this.measure(request.job, result.duration, result.work);
        this.presented = Math.max(this.presented, request.id);
        this.presentedJob = result.density
          ? { ...request.job, densityReference: result.density.referenceValue }
          : request.job;
        this.presentedRemote = false;
        this.cancelInspection();
        this.reportFrame(request, result);
      }
      request.resolve(Boolean(result));
    } catch (error) {
      this.statistics.failed++;
      request.reject(error);
    }
  }

  /**
   * Pin an offloaded mode to its worker so incremental caches survive later small jobs instead of
   * bouncing between threads.
   */
  start(request) {
    if (!this.supported) {
      this.local(request);
      return;
    }
    this.active = request;
    request.started = performance.now();
    this.statistics.started++;
    this.offloaded.add(this.key(request.job));
    try {
      if (!this.worker) {
        const worker = (this.worker = this.workerFactory());
        worker.onmessage = ({ data }) => {
          if (worker !== this.worker) {
            data.bitmap?.close();
            return;
          }
          if (data.inspection !== undefined) {
            if (this.workerInspection === data.inspection)
              this.workerInspection = undefined;
            this.finishInspection(data);
            const pending = this.pendingInspection;
            this.pendingInspection = null;
            if (pending && this.inspection?.id === pending.inspection)
              this.sendInspection(pending);
            return;
          }
          this.finish(data);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          if (worker === this.worker) this.failed();
        };
        worker.onmessageerror = () => {
          if (worker === this.worker) this.failed();
        };
      }
      this.worker.postMessage({ id: request.id, job: request.job });
    } catch {
      this.failed();
    }
  }

  /**
   * Present only compatible frames and close every transferred bitmap, including stale ones, before
   * starting the latest pending job.
   */
  finish({
    id,
    bitmap,
    duration,
    work,
    dimensions,
    timings,
    reused,
    diagnostics,
    density,
    canceled,
    error,
    jobError,
  }) {
    if (error) {
      if (jobError) {
        const request = this.active;
        if (!request || request.id !== id) return;
        this.active = null;
        this.statistics.failed++;
        if (request.id === this.version) request.reject(new Error(error));
        else request.resolve(false);
        const next = this.pending;
        this.pending = null;
        if (next) this.start(next);
        return;
      }
      this.failed();
      return;
    }
    const request = this.active;
    if (!request || request.id !== id) {
      bitmap?.close();
      return;
    }
    this.active = null;
    this.statistics.completed++;
    if (canceled) this.statistics.canceled++;
    try {
      if (!canceled) this.measure(request.job, duration, work);
      const present = !canceled && this.canPresent(request);
      if (present) {
        const presentationStarted = performance.now();
        if (this.canvas.width !== bitmap.width)
          this.canvas.width = bitmap.width;
        if (this.canvas.height !== bitmap.height)
          this.canvas.height = bitmap.height;
        const context = this.canvas.getContext("2d");
        context.clearRect(0, 0, bitmap.width, bitmap.height);
        context.drawImage(bitmap, 0, 0);
        request.presentationMilliseconds =
          performance.now() - presentationStarted;
        this.statistics.presented++;
        this.presented = id;
        this.presentedJob = density
          ? { ...request.job, densityReference: density.referenceValue }
          : request.job;
        this.presentedRemote = true;
        this.cancelInspection();
        this.reportFrame(request, {
          duration,
          dimensions,
          timings,
          reused,
          diagnostics,
        });
      }
      request.resolve(present);
    } catch (error) {
      request.reject(error);
    } finally {
      bitmap?.close();
    }
    const next = this.pending;
    this.pending = null;
    if (next) this.start(next);
  }

  /** Inspect the displayed snapshot, even if a newer render is pending. Metadata stays in its owner thread. */
  inspect(x, y) {
    this.cancelInspection();
    if (!this.presentedJob || this.presentedJob.kind !== "view")
      return Promise.resolve(null);
    const id = (this.inspectionSerial = (this.inspectionSerial || 0) + 1),
      frameId = this.presented,
      job = this.presentedJob;
    return new Promise((resolve, reject) => {
      this.inspection = { id, frameId, resolve, reject };
      if (this.presentedRemote && this.worker) {
        const message = { inspection: id, frameId, job, x, y };
        if (this.workerInspection !== undefined)
          this.pendingInspection = message;
        else this.sendInspection(message);
      } else {
        inspectPoint(
          job,
          this.cache,
          x,
          y,
          () => this.inspection?.id === id && this.presented === frameId,
        ).then(
          (point) => this.finishInspection({ inspection: id, point }),
          (error) =>
            this.finishInspection({ inspection: id, error: error.message }),
        );
      }
    });
  }
  sendInspection(message) {
    this.workerInspection = message.inspection;
    try {
      this.worker.postMessage(message);
    } catch (error) {
      this.workerInspection = undefined;
      this.finishInspection({
        inspection: message.inspection,
        error: error.message,
      });
    }
  }
  finishInspection({ inspection, point, error }) {
    const request = this.inspection;
    if (!request || request.id !== inspection) return;
    this.inspection = null;
    if (request.frameId !== this.presented) request.resolve(null);
    else if (error) request.reject(new Error(error));
    else request.resolve(point);
  }
  cancelInspection() {
    this.inspection?.resolve(null);
    this.inspection = null;
    this.pendingInspection = null;
  }

  /**
   * Fall back only for the newest request; replaying an obsolete queue after worker failure would
   * regress the visible state.
   */
  failed() {
    this.statistics.failed++;
    this.cancelInspection();
    this.workerInspection = undefined;
    this.supported = false;
    this.worker?.terminate();
    this.worker = null;
    const active = this.active,
      pending = this.pending;
    this.active = this.pending = null;
    for (const request of [active, pending]) {
      if (!request) continue;
      if (request.id === this.version) this.local(request);
      else request.resolve(false);
    }
  }

  /**
   * Invalidate in-flight continuations, settle promises, and destroy owned caches when a canvas
   * disconnects.
   */
  cancel() {
    this.cancelInspection();
    this.workerInspection = undefined;
    this.presentedJob = null;
    this.version++;
    this.latest = null;
    this.worker?.terminate();
    this.worker = null;
    this.active?.resolve(false);
    this.pending?.resolve(false);
    this.active = this.pending = null;
    this.cache.pointGPU?.dispose?.();
    this.cache.pointCompute?.dispose?.();
    this.cache = {};
    this.offloaded.clear();
  }
}
