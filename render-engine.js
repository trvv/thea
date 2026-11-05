import { executeRender, renderCost } from './rendering.js';

export class RenderEngine {
	// Spend at most half a 60 Hz frame on predicted UI-thread rendering.
	constructor(canvas, { budget = 8, workerFactory } = {}) {
		this.canvas = canvas;
		this.budget = budget;
		this.workerFactory = workerFactory || (() => new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' }));
		this.supported = Boolean(workerFactory) || (typeof Worker === 'function' && typeof OffscreenCanvas === 'function'
			&& typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function');
		this.rates = new Map();
		this.offloaded = new Set();
		this.cache = {};
		this.version = 0;
		this.presented = 0;
		this.sourceIds = new WeakMap();
		this.sourceSerial = 0;
	}

	key(job) {
		if (job.region === 'trigraph' && job.frequencyOpacity) return 'trigraph-opacity';
		return job.kind === 'bar' ? 'bar' : ['digraph', 'dft', 'trigraph'].includes(job.region) ? job.region : job.shaders.some(shader => shader === 'character' || shader === 'hex') ? 'text' : 'pixels';
	}

	estimate(job) {
		return renderCost(job) * (this.rates.get(this.key(job)) || 0.00002);
	}

	measure(job, duration, work = renderCost(job)) {
		const cost = work;
		if (cost < 4096 || !Number.isFinite(duration)) return;
		const key = this.key(job);
		const previous = this.rates.get(key) || 0.00002;
		const observed = Math.max(0.000002, Math.min(0.002, duration / cost));
		this.rates.set(key, previous * 0.8 + observed * 0.2);
	}

	reportFrame(request) {
		const frame = { job: request.job, duration: performance.now() - request.started };
		queueMicrotask(() => this.onFrame?.(frame));
	}

	canPresent(request) {
		if (request.id <= this.presented) return false;
		if (request.id === this.version) return true;
		const latest = this.latest;
		// During scrolling, present completed frames in order instead of waiting
		// indefinitely for a request with no newer pointer event behind it.
		if (request.job.progressive && latest?.progressive && request.job.kind === 'view' && latest.kind === 'view'
			&& ['sourceId', 'region', 'columns', 'rows', 'encoding', 'blankSpaces', 'blankNulls', 'frequencyOpacity', 'coordinateSystem', 'pointScale'].every(key => request.job[key] === latest[key])
			&& request.job.shaders.join() === latest.shaders.join() && request.job.axes?.join() === latest.axes?.join()) return true;
		// Camera-only updates also work for standalone renderer clients.
		return request.job.region === 'trigraph' && latest?.region === 'trigraph'
			&& ['sourceId', 'offset', 'length', 'columns', 'rows', 'frequencyOpacity', 'coordinateSystem', 'pointScale'].every(key => request.job[key] === latest[key])
			&& request.job.axes?.join() === latest.axes?.join();
	}

	render(job) {
		if (!this.sourceIds.has(job.source)) this.sourceIds.set(job.source, ++this.sourceSerial);
		job = { ...job, sourceId: this.sourceIds.get(job.source) };
		const id = ++this.version;
		this.latest = job;
		// One running worker job and one replaceable pending job per canvas.
		this.pending?.resolve(false);
		this.pending = null;
		return new Promise((resolve, reject) => {
			const request = { id, job, resolve, reject };
			if (this.supported && (this.estimate(job) >= this.budget || this.offloaded.has(this.key(job)))) {
				if (this.active) this.pending = request;
				else this.start(request);
			} else this.local(request);
		});
	}

	async local(request) {
		request.started = performance.now();
		try {
			const result = await executeRender(this.canvas, request.job, this.cache, () => request.id === this.version);
			if (result) {
				this.measure(request.job, result.duration, result.work);
				this.presented = Math.max(this.presented, request.id);
				this.reportFrame(request);
			}
			request.resolve(Boolean(result));
		} catch (error) { request.reject(error); }
	}

	start(request) {
		if (!this.supported) { this.local(request); return; }
		this.active = request;
		request.started = performance.now();
		this.offloaded.add(this.key(request.job));
		try {
			if (!this.worker) {
				const worker = this.worker = this.workerFactory();
				worker.onmessage = ({ data }) => {
					if (worker !== this.worker) { data.bitmap?.close(); return; }
					this.finish(data);
				};
				worker.onerror = event => { event.preventDefault(); if (worker === this.worker) this.failed(); };
				worker.onmessageerror = () => { if (worker === this.worker) this.failed(); };
			}
			this.worker.postMessage({ id: request.id, job: request.job });
		} catch { this.failed(); }
	}

	finish({ id, bitmap, duration, work, error }) {
		if (error) { this.failed(); return; }
		const request = this.active;
		if (!request || request.id !== id) { bitmap?.close(); return; }
		this.active = null;
		try {
			this.measure(request.job, duration, work);
			const present = this.canPresent(request);
			if (present) {
				if (this.canvas.width !== bitmap.width) this.canvas.width = bitmap.width;
				if (this.canvas.height !== bitmap.height) this.canvas.height = bitmap.height;
				const context = this.canvas.getContext('2d');
				context.clearRect(0, 0, bitmap.width, bitmap.height);
				context.drawImage(bitmap, 0, 0);
				this.presented = id;
				this.reportFrame(request);
			}
			request.resolve(present);
		} catch (error) { request.reject(error); }
		finally { bitmap?.close(); }
		const next = this.pending;
		this.pending = null;
		if (next) this.start(next);
	}

	failed() {
		this.supported = false;
		this.worker?.terminate();
		this.worker = null;
		const active = this.active, pending = this.pending;
		this.active = this.pending = null;
		for (const request of [active, pending]) {
			if (!request) continue;
			if (request.id === this.version) this.local(request);
			else request.resolve(false);
		}
	}

	cancel() {
		this.version++;
		this.latest = null;
		this.worker?.terminate();
		this.worker = null;
		this.active?.resolve(false);
		this.pending?.resolve(false);
		this.active = this.pending = null;
		this.cache = {};
		this.offloaded.clear();
	}
}
