// Resolution changes are based on sustained measured misses, not pointer motion
// alone. Transient setup costs and frames rebuilding a resized cache are ignored.
export class AdaptiveResolution {
	constructor({ budget = 1000 / 60, minimum = 0.25 } = {}) {
		this.budget = budget;
		this.minimum = minimum;
		this.scale = 1;
		this.moving = false;
		this.resetMeasurements();
	}

	resetMeasurements() {
		this.slow = this.fast = this.warmup = 0;
		this.trial = null;
		this.locked = false;
	}

	touch() {
		if (!this.moving) this.resetMeasurements();
		this.moving = true;
	}

	settle() {
		const changed = this.scale !== 1;
		this.scale = 1;
		this.moving = false;
		this.resetMeasurements();
		return changed;
	}

	record(duration, scale) {
		if (!this.moving || scale !== this.scale || !Number.isFinite(duration) || duration <= 0 || this.locked) return false;
		if (this.warmup) { this.warmup--; return false; }
		if (duration > this.budget * 1.1) {
			this.fast = 0;
			if (++this.slow < 2) return false;
			this.slow = 0;
			// If a reduction did not help, fixed per-point work is the bottleneck.
			// Restore detail instead of repeatedly shrinking the same slow frame.
			if (this.trial && duration >= this.trial.duration * 0.95) {
				this.scale = this.trial.scale;
				this.locked = true;
				return true;
			}
			const next = Math.max(this.minimum, Math.floor(this.scale * Math.min(0.85, Math.sqrt(this.budget / duration)) * 20) / 20);
			if (next >= this.scale) return false;
			this.trial = { scale: this.scale, duration };
			this.scale = next;
			this.warmup = 1;
			return true;
		}
		this.slow = 0;
		this.trial = null;
		if (duration < this.budget * 0.6 && this.scale < 1) {
			if (++this.fast < 6) return false;
			this.fast = 0;
			this.scale = Math.min(1, Math.round((this.scale + 0.1) * 20) / 20);
			this.warmup = 1;
			return true;
		}
		this.fast = 0;
		return false;
	}
}
