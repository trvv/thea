import { AdaptiveResolution } from './adaptive-resolution.js';
import { coordinateDimensions, sourceDimensions } from './coordinates.js';
import { RenderEngine } from "./render-engine.js";
export { byteCharacter, hilbertCells, entropyShading, cellColor } from "./rendering.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class Popup extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' }).innerHTML = `
			<style>
				:host { position: fixed; margin: 0; padding: 4px; color: CanvasText; background: Canvas;
					border: 1px solid ButtonBorder; border-radius: 4px; font: 13px system-ui;
					min-width: 200px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px);
					overflow: auto; box-sizing: border-box; box-shadow: 0 2px 6px #0002; }
			</style>
			<slot></slot>`;
	}

	connectedCallback() { this.setAttribute('popover', 'auto'); }

	open(x, y) {
		this.style.left = `${x}px`;
		this.style.top = `${y}px`;
		this.showPopover();
		const bounds = this.getBoundingClientRect();
		this.style.left = `${clamp(x, 0, Math.max(0, innerWidth - bounds.width))}px`;
		this.style.top = `${clamp(y, 0, Math.max(0, innerHeight - bounds.height))}px`;
	}

	close() { this.hidePopover(); }
}

export class ContextMenu extends Popup {
	constructor() {
		super();
		this.addEventListener('keydown', event => {
			if (['SELECT', 'INPUT'].includes(event.target.tagName)) return;
			const items = [...this.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled)')];
			const index = items.indexOf(this.getRootNode().activeElement);
			let next;
			if (event.key === 'ArrowDown') next = (index + 1) % items.length;
			if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
			if (event.key === 'Home') next = 0;
			if (event.key === 'End') next = items.length - 1;
			if (next === undefined || !items.length) return;
			event.preventDefault();
			items[next].focus();
		});
	}

	connectedCallback() {
		super.connectedCallback();
		this.setAttribute('role', 'menu');
	}

	set items(items) {
		const create = ({ label, checked, action, kind = 'radio', disabled = false, options, input, value, min, items: children }) => {
			if (children) {
				const group = document.createElement('div');
				group.style.cssText = 'padding:0';
				group.setAttribute('role', 'group');
				group.setAttribute('aria-label', label);
				group.append(...children.map(create));
				return group;
			}
			if (options || input) {
				const row = document.createElement('label');
				row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:4px 8px 4px 28px;min-height:24px';
				row.textContent = label;
				const select = document.createElement(input ? 'input' : 'select');
				if (input) { select.type = input; select.min = min; select.step = 1; select.style.width = '64px'; }
				select.disabled = disabled;
				select.style.cssText = `font:inherit;margin-left:auto;max-width:140px;${input ? 'width:64px' : ''}`;
				select.setAttribute('aria-label', label);
				for (const option of options || []) {
					const item = document.createElement('option');
					item.value = option.value;
					item.textContent = option.label;
					select.append(item);
				}
				select.value = value;
				select.addEventListener('change', () => {
					if (input && !select.checkValidity()) { select.value = value; return; }
					action(input ? Number(select.value) : select.value);
				});
				if (disabled) row.style.color = 'GrayText';
				row.append(select);
				return row;
			}
			const button = document.createElement('button');
			button.type = 'button';
			button.disabled = disabled;
			const mark = document.createElement('span');
			mark.textContent = checked ? (kind === 'radio' ? '•' : '✓') : '';
			mark.setAttribute('aria-hidden', 'true');
			const caption = document.createElement('span');
			caption.textContent = label;
			button.append(mark, caption);
			button.style.cssText = 'display:grid;grid-template-columns:12px 1fr;align-items:center;gap:8px;width:100%;min-height:28px;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-radius:2px;padding:4px 8px;cursor:default';
			if (disabled) button.style.color = 'GrayText';
			button.addEventListener('pointerenter', () => button.focus());
			button.addEventListener('focus', () => { button.style.background = 'Highlight'; button.style.color = 'HighlightText'; });
			button.addEventListener('blur', () => { button.style.background = 'transparent'; button.style.color = 'inherit'; });
			button.setAttribute('role', checked === undefined ? 'menuitem' : `menuitem${kind}`);
			if (checked !== undefined) button.setAttribute('aria-checked', String(checked));
			button.addEventListener('click', () => { if (!button.disabled) { this.close(); action(); } });
			return button;
		};
		this.replaceChildren(...items.map((item, index) => {
			const element = create(item);
			if (index && item.items) element.style.cssText += ';border-top:1px solid ButtonBorder;margin-top:4px;padding-top:4px';
			return element;
		}));
	}

	open(x, y) {
		super.open(x, y);
		(this.querySelector('button[aria-checked="true"]:not(:disabled)') || this.querySelector('button:not(:disabled)'))?.focus();
	}
}

class ByteCanvas extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' }).innerHTML = `
			<style>
				:host { display: block; position: relative; min-width: 0; overflow: hidden; }
				canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
			</style>
			<canvas></canvas>`;
		this.canvas = this.shadowRoot.querySelector('canvas');
		this.renderer = new RenderEngine(this.canvas);
		this.observer = new ResizeObserver(() => this.render());
	}

	connectedCallback() { this.observer.observe(this); this.render(); }
	disconnectedCallback() {
		this.observer.disconnect();
		this.renderer.cancel();
		this.version = (this.version || 0) + 1;
	}

	grid(pixelSize) {
		const width = Math.max(1, Math.floor(this.clientWidth / pixelSize));
		const height = Math.max(1, Math.floor(this.clientHeight / pixelSize));
		return { width, height, count: width * height };
	}

	failure(error) {
		this.dispatchEvent(new CustomEvent('data-error', { detail: error, bubbles: true, composed: true }));
	}
}

export class DataScrollView extends ByteCanvas {
	constructor() {
		super();
		this.rotation = { yaw: -0.6, pitch: 0.45 };
		this.resolution = new AdaptiveResolution();
		this.renderer.onFrame = ({ job, duration }) => {
			if (job.region !== 'trigraph' || this.region !== 'trigraph' || !job.interacting
				|| job.source !== this.source || job.width !== this.clientWidth || job.height !== this.clientHeight || job.scale !== (globalThis.devicePixelRatio || 1)
				|| job.frequencyOpacity !== this.frequencyOpacity || job.coordinateSystem !== this.coordinateSystem || job.axes.join() !== this.axes.join()) return;
			if (this.resolution.record(duration, job.resolutionScale)) this.scheduleRotationRender();
		};
		this.addEventListener('pointerdown', event => {
			if (event.button !== 0) return;
			this.focus();
			if (this.region !== 'trigraph') return;
			event.preventDefault();
			this.setPointerCapture(event.pointerId);
			this.rotationDrag = { x: event.clientX, y: event.clientY, ...this.rotation };
			this.style.cursor = 'grabbing';
		});
		this.addEventListener('pointermove', event => {
			if (!this.rotationDrag || !this.hasPointerCapture(event.pointerId)) return;
			const drag = this.rotationDrag;
			this.noteMovement();
			this.rotation = { yaw: drag.yaw + (event.clientX - drag.x) * 0.01,
				pitch: clamp(drag.pitch + (event.clientY - drag.y) * 0.01, -Math.PI / 2, Math.PI / 2) };
			this.scheduleRotationRender();
		});
		const stopRotation = () => { this.rotationDrag = null; this.style.cursor = this.region === 'trigraph' ? 'grab' : ''; };
		this.addEventListener('pointerup', event => {
			if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
			stopRotation();
		});
		this.addEventListener('pointercancel', stopRotation);
		this.addEventListener('lostpointercapture', stopRotation);
		this.addEventListener('keydown', event => {
			if (event.altKey || event.ctrlKey || event.metaKey || !this.source) return;
			const columns = this.columns || 1;
			const steps = {
				ArrowLeft: -1, ArrowRight: 1,
				ArrowUp: -columns, ArrowDown: columns,
				PageUp: -this.length, PageDown: this.length,
				Home: -Infinity, End: Infinity
			};
			if (!(event.key in steps)) return;
			event.preventDefault();
			this.dispatchEvent(new CustomEvent('seek', { detail: this.offset + steps[event.key] }));
		});
	}

	noteMovement() {
		if (this.region !== 'trigraph') return;
		this.resolution.touch();
		clearTimeout(this.resolutionTimer);
		this.resolutionTimer = setTimeout(() => {
			this.resolutionTimer = undefined;
			if (this.resolution.settle() && this.isConnected && this.region === 'trigraph') {
				this.cancelRotationRender();
				this.render();
			}
		}, 180);
	}

	resetResolution() {
		clearTimeout(this.resolutionTimer);
		this.resolutionTimer = undefined;
		this.resolution.settle();
	}

	scheduleRotationRender() {
		if (typeof requestAnimationFrame !== 'function') { this.render(); return; }
		if (this.rotationFrame !== undefined) return;
		this.rotationFrame = requestAnimationFrame(() => {
			this.rotationFrame = undefined;
			if (this.isConnected && this.region === 'trigraph') this.render();
		});
	}

	cancelRotationRender() {
		if (this.rotationFrame !== undefined) globalThis.cancelAnimationFrame?.(this.rotationFrame);
		this.rotationFrame = undefined;
	}

	disconnectedCallback() {
		this.resetResolution();
		this.cancelRotationRender();
		this.rotationDrag = null;
		super.disconnectedCallback();
	}

	connectedCallback() {
		this.tabIndex = 0;
		super.connectedCallback();
	}

	get shaders() { return this._shaders || ['entropy', 'brightness']; }

	set shaders(shaders) {
		if (!Array.isArray(shaders) || shaders.some(shader => !['entropy', 'brightness', 'character', 'hex'].includes(shader))) {
			throw new TypeError('Unknown cell shader');
		}
		const label = shaders.findLast(shader => shader === 'character' || shader === 'hex');
		this._shaders = [...new Set(shaders.filter(shader => !['character', 'hex'].includes(shader) || shader === label))];
		this.render();
	}

	get blankSpaces() { return this._blankSpaces || false; }
	set blankSpaces(value) { this._blankSpaces = Boolean(value); this.render(); }

	get blankNulls() { return this._blankNulls ?? true; }
	set blankNulls(value) { this._blankNulls = Boolean(value); this.render(); }

	get encoding() { return this._encoding || 'ascii'; }
	set encoding(value) {
		if (!['ascii-overbar', 'ascii', 'cp437', 'latin1'].includes(value)) throw new TypeError('Unknown character encoding');
		this._encoding = value;
		this.render();
	}

	get frequencyOpacity() { return this._frequencyOpacity || false; }
	set frequencyOpacity(value) { this._frequencyOpacity = Boolean(value); this.render(); }

	get coordinateSystem() { return this._coordinateSystems?.[this.region] || 'cartesian'; }
	set coordinateSystem(value) {
		const allowed = this.region === 'trigraph' ? ['cartesian', 'cylindrical', 'spherical'] : ['cartesian', 'radial'];
		if (!allowed.includes(value)) throw new TypeError('Unknown coordinate system');
		(this._coordinateSystems ||= {})[this.region] = value;
		this.render();
	}

	get axes() { return this._axisMappings?.[this.region] || (this.region === 'trigraph' ? [0, 1, 2] : [0, 1]); }
	set axes(value) {
		const count = this.region === 'trigraph' ? 3 : 2;
		if (!Array.isArray(value) || value.length !== count || new Set(value).size !== count
			|| value.some(axis => !Number.isInteger(axis) || axis < 0 || axis >= count)) throw new TypeError('Expected an axis permutation');
		(this._axisMappings ||= {})[this.region] = [...value];
		this.render();
	}

	setAxis(index, dimension) {
		const axes = [...this.axes], other = axes.indexOf(dimension);
		if (other < 0 || index < 0 || index >= axes.length) throw new TypeError('Unknown axis');
		[axes[index], axes[other]] = [axes[other], axes[index]];
		this.axes = axes;
	}

	get region() { return this._region || 'linear'; }

	set region(region) {
		if (!['linear', 'hilbert', 'digraph', 'dft', 'trigraph'].includes(region)) throw new TypeError('Unknown region layout');
		this._region = region;
		this.resetResolution();
		this.cancelRotationRender();
		this.rotationDrag = null;
		this.style.touchAction = region === 'trigraph' ? 'none' : '';
		this.style.cursor = region === 'trigraph' ? 'grab' : '';
		this.render();
	}

	layout(requestedLength, size = this.source?.size ?? requestedLength) {
		const length = Math.min(size, Math.max(1, Math.round(requestedLength)));
		if (this.region === 'trigraph') {
			const scale = globalThis.devicePixelRatio || 1;
			return { columns: Math.max(1, Math.round(this.clientWidth * scale)), rows: Math.max(1, Math.round(this.clientHeight * scale)), length };
		}
		if (this.region === 'dft') return { columns: 513, rows: Math.max(1, Math.min(1024, Math.round(this.clientHeight * (globalThis.devicePixelRatio || 1)))), length };
		if (this.region === 'digraph') return { columns: 256, rows: 256, length };
		if (this.region === 'hilbert') {
			const side = 2 ** Math.ceil(Math.log2(Math.sqrt(Math.max(1, length))));
			return { columns: side, rows: side, length };
		}
		const aspect = this.shaders.includes('hex') ? 1.2 : this.shaders.includes('character') ? 0.6 : 1;
		const ratio = Math.max(1, this.clientWidth) / (Math.max(1, this.clientHeight) * aspect);
		const columns = clamp(Math.round(Math.sqrt(length * ratio)), 1, Math.max(1, length));
		const rows = clamp(this.wholeBuffer ? Math.floor(length / columns) : Math.round(length / columns), 1, Math.max(1, Math.floor(size / columns)));
		return { columns, rows, length: this.wholeBuffer ? length : size ? columns * rows : 0 };
	}

	setWindow(source, offset, length, layout) {
		const sourceChanged = this.source !== source;
		const moved = this.offset !== offset || this.length !== length;
		const resized = !this.windowLayout || !layout || ['columns', 'rows', 'length', 'limit'].some(key => layout[key] !== this.windowLayout[key]);
		if (sourceChanged) this.resetResolution();
		else if (moved) this.noteMovement();
		Object.assign(this, { source, offset, length, windowLayout: layout });
		if (sourceChanged || moved || resized) this.render();
	}

	async render() {
		const version = this.version = (this.version || 0) + 1;
		if (!this.source || !this.isConnected) return;
		const shaders = this.shaders;
		const layout = this.windowLayout ? this.layout(this.requestedLength, this.windowLayout.limit) : this.layout(this.length);
		if (this.windowLayout && ['columns', 'rows', 'length'].some(key => layout[key] !== this.windowLayout[key])) {
			this.dispatchEvent(new CustomEvent('layout-change'));
			return;
		}
		const { columns, rows } = layout;
		const resolutionScale = this.region === 'trigraph' && this.resolution.moving ? this.resolution.scale : 1;
		try {
			const rendered = await this.renderer.render({
				kind: 'view', progressive: true, source: this.source, offset: this.offset, length: this.length,
				columns: Math.max(1, Math.round(columns * resolutionScale)), rows: Math.max(1, Math.round(rows * resolutionScale)),
				resolutionScale, pointScale: this.region === 'trigraph' ? (globalThis.devicePixelRatio || 1) * resolutionScale : 1, interacting: this.region === 'trigraph' && this.resolution.moving,
				region: this.region, shaders, rotation: this.rotation, frequencyOpacity: this.frequencyOpacity, coordinateSystem: this.coordinateSystem, axes: this.axes,
				width: this.clientWidth, height: this.clientHeight, scale: globalThis.devicePixelRatio || 1,
				encoding: this.encoding, blankSpaces: this.blankSpaces, blankNulls: this.blankNulls
			});
			if (rendered && version === this.version) Object.assign(this, { columns, rows });
		} catch (error) { if (version === this.version) this.failure(error); }
	}
}

export class DataScrollBar extends ByteCanvas {
	constructor() {
		super();
		this.cursor = document.createElement('div');
		this.cursor.style.cssText = 'position:absolute;left:0;right:0;outline:1px solid #b89700;outline-offset:-1px;background:#ffdf0040;pointer-events:none;min-height:3px';
		this.shadowRoot.append(this.cursor);
		this.addEventListener('pointerdown', event => {
			if (this.auto) { event.preventDefault(); this.stopAuto(); return; }
			if (![0, 1].includes(event.button) || !this.source?.size) return;
			if (event.button === 1) { event.preventDefault(); this.startAuto(event); return; }
			event.preventDefault();
			this.setPointerCapture(event.pointerId);
			this.focus();
			const edge = this.edgeAt(event.clientY);
			const cursor = this.cursor.getBoundingClientRect();
			if (!edge && (event.clientY < cursor.top || event.clientY > cursor.bottom)) this.seekAt(event);
			this.drag = { edge, y: event.clientY, start: this.offset, end: this.offset + this.length };
		});
		this.addEventListener('pointermove', event => {
			if (this.auto) return;
			if (this.hasPointerCapture(event.pointerId)) this.dragAt(event);
			else this.style.cursor = this.edgeAt(event.clientY) ? 'ns-resize' : 'grab';
		});
		this.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
		this.addEventListener('pointerup', event => {
			if (this.auto?.pointerId === event.pointerId) {
				if (this.auto.moved) this.stopAuto();
				else {
					this.auto.latched = true;
					if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
				}
				return;
			}
			if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
			this.drag = null;
		});
		this.addEventListener('pointercancel', () => { this.drag = null; this.stopAuto(); });
		this.addEventListener('lostpointercapture', () => { this.drag = null; if (this.auto && !this.auto.latched) this.stopAuto(); });
		this.addEventListener('keydown', event => {
			const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1, PageUp: -this.length, PageDown: this.length, Home: -Infinity, End: Infinity };
			if (!(event.key in steps)) return;
			event.preventDefault();
			this.seek(this.offset + steps[event.key]);
		});
	}

	connectedCallback() {
		this.style.touchAction = 'none';
		this.tabIndex = 0;
		this.setAttribute('role', 'scrollbar');
		this.setAttribute('aria-label', 'Binary window');
		this.setAttribute('aria-orientation', 'vertical');
		super.connectedCallback();
	}

	disconnectedCallback() { this.stopAuto(); super.disconnectedCallback(); }

	startAuto(event) {
		this.focus();
		this.setPointerCapture(event.pointerId);
		this.auto = {
			pointerId: event.pointerId, origin: event.clientY, y: event.clientY,
			edge: this.edgeAt(event.clientY), remainder: 0, moved: false,
			start: this.offset, end: this.offset + this.length, travel: 0,
			controller: new AbortController()
		};
		this.style.cursor = 'ns-resize';
		const { signal } = this.auto.controller;
		window.addEventListener('pointermove', event => {
			if (event.pointerId !== this.auto.pointerId) return;
			this.auto.y = event.clientY;
			if (Math.abs(event.clientY - this.auto.origin) > 4) this.auto.moved = true;
		}, { signal });
		window.addEventListener('pointerdown', event => {
			if (!event.composedPath().includes(this)) this.stopAuto();
		}, { signal, capture: true });
		window.addEventListener('keydown', event => {
			if (event.key === 'Escape') { event.preventDefault(); this.stopAuto(); }
		}, { signal });
		window.addEventListener('blur', () => this.stopAuto(), { signal });
		this.auto.frame = requestAnimationFrame(time => this.tickAuto(time));
	}

	tickAuto(time) {
		const auto = this.auto;
		if (!auto) return;
		const elapsed = auto.time === undefined ? 0 : Math.min(100, time - auto.time) / 1000;
		auto.time = time;
		const distance = auto.y - auto.origin;
		const speed = Math.sign(distance) * Math.max(0, Math.abs(distance) - 4);
		const height = this.getBoundingClientRect().height;
		if (height && this.source?.size) {
			auto.remainder += speed * this.source.size / height * elapsed;
			const delta = Math.trunc(auto.remainder);
			auto.remainder -= delta;
			if (delta && auto.edge) {
				const min = auto.edge === 'top' ? -auto.start : auto.start + 1 - auto.end;
				const max = auto.edge === 'top' ? auto.end - 1 - auto.start : this.source.size - auto.end;
				auto.travel = clamp(auto.travel + delta, min, max);
				this.moveWindow(auto.travel, auto.edge, auto.start, auto.end);
			} else if (delta) this.moveWindow(delta, null);
		}
		if (this.auto === auto) auto.frame = requestAnimationFrame(next => this.tickAuto(next));
	}

	stopAuto() {
		const auto = this.auto;
		if (!auto) return;
		this.auto = null;
		cancelAnimationFrame(auto.frame);
		auto.controller.abort();
		if (this.hasPointerCapture(auto.pointerId)) this.releasePointerCapture(auto.pointerId);
		this.style.cursor = '';
	}

	setWindow(source, offset, length, scope) {
		const changed = this.source !== source;
		if (changed) this.stopAuto();
		Object.assign(this, { source, offset, length, scope });
		if (this.isConnected) this.updateCursor();
		if (changed) this.render();
	}

	seek(offset) {
		if (!this.source) return;
		this.dispatchEvent(new CustomEvent('seek', {
			detail: clamp(Math.round(offset), 0, Math.max(0, this.source.size - this.length))
		}));
	}

	seekAt(event) {
		if (!this.source) return;
		const bounds = this.getBoundingClientRect();
		this.seek((event.clientY - bounds.top) / bounds.height * this.source.size - this.length / 2);
	}

	edgeAt(y) {
		const bounds = this.cursor.getBoundingClientRect();
		const top = Math.abs(y - bounds.top);
		const bottom = Math.abs(y - bounds.bottom);
		if (Math.min(top, bottom) > 6) return null;
		return top <= bottom ? 'top' : 'bottom';
	}

	dragAt(event) {
		if (!this.drag || !this.source?.size) return;
		const height = this.getBoundingClientRect().height;
		if (!height) return;
		const delta = Math.round((event.clientY - this.drag.y) / height * this.source.size);
		const { edge, start, end } = this.drag;
		this.moveWindow(delta, edge, start, end);
	}

	moveWindow(delta, edge, start = this.offset, end = this.offset + this.length) {
		if (!edge) { this.seek(start + delta); return; }
		const offset = edge === 'top' ? clamp(start + delta, 0, end - 1) : start;
		const limit = edge === 'bottom' ? clamp(end + delta, start + 1, this.source.size) : end;
		this.dispatchEvent(new CustomEvent('window-change', { detail: { offset, length: limit - offset, edge } }));
	}

	updateCursor() {
		const size = this.source?.size || 1;
		this.cursor.style.top = `${100 * (this.offset || 0) / size}%`;
		this.cursor.style.height = `${100 * Math.min(1, (this.length || 0) / size)}%`;
		this.setAttribute('aria-valuemin', '0');
		this.setAttribute('aria-valuemax', String(Math.max(0, size - this.length)));
		this.setAttribute('aria-valuenow', String(this.offset || 0));
	}

	async render() {
		const version = this.version = (this.version || 0) + 1;
		if (!this.source || !this.isConnected) return;
		const { width, height } = this.grid(1);
		try {
			const rendered = await this.renderer.render({ kind: 'bar', source: this.scope?.source || this.source, offset: this.scope?.offset || 0, length: this.source.size, width, height });
			if (rendered && version === this.version) this.updateCursor();
		} catch (error) { if (version === this.version) this.failure(error); }
	}
}

export class DataScroll extends HTMLElement {
	constructor(source, windowSize = 1024) {
		super();
		this.attachShadow({ mode: 'open' }).innerHTML = `
			<style>
				:host { position: fixed; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: minmax(0, 1fr); }
				data-scroll-view, .bars { height: 100%; min-height: 0; }
				.bars { display: flex; }
				data-scroll-bar { width: 48px; height: 100%; }
			</style>
			<data-scroll-view></data-scroll-view><div class="bars"></div>`;
		this.view = this.shadowRoot.querySelector('data-scroll-view');
		this.barContainer = this.shadowRoot.querySelector('.bars');
		this.levels = [];
		this.windowSize = windowSize;
		this.offset = 0;
		this.barCount = 1;
		this.menu = new ContextMenu();
		this.shadowRoot.append(this.menu);
		this.addEventListener('contextmenu', event => {
			event.preventDefault();
			this.refreshMenu();
			this.menu.open(event.clientX, event.clientY);
		});
		this.view.addEventListener('seek', event => this.seek(event.detail));
		this.view.addEventListener('layout-change', () => this.seek(this.offset));
		this.wheelRows = 0;
		this.addEventListener('wheel', event => {
			if (event.ctrlKey || !event.deltaY || !this.source || event.composedPath().includes(this.menu)) return;
			event.preventDefault();
			const rows = this.view.rows || 1;
			const delta = event.deltaMode === 1 ? event.deltaY
				: event.deltaMode === 2 ? event.deltaY * rows
				: event.deltaY / Math.max(1, this.view.clientHeight / rows);
			this.wheelRows += delta;
			const step = Math.trunc(this.wheelRows);
			this.wheelRows -= step;
			if (step) {
				const level = this.levels.find(level => event.composedPath().includes(level.bar));
				if (level) level.bar.seek(level.offset + step * (this.view.columns || 1));
				else this.seek(this.offset + step * (this.view.columns || 1));
			}
		}, { passive: false });
		if (source) this.source = source;
	}

	refreshMenu(focus) {
		this.menu.items = this.contextItems();
		if (focus) this.menu.querySelector?.(`select[aria-label="${focus}"]`)?.focus();
	}

	coordinateMenu() {
		const spatial = this.view.region === 'trigraph';
		const systems = spatial ? ['cartesian', 'cylindrical', 'spherical'] : ['cartesian', 'radial'];
		const dimensions = sourceDimensions(this.view.region);
		return { label: 'Coordinates', items: [
			{ label: 'Coordinates', value: this.view.coordinateSystem,
				options: systems.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
				action: value => { this.view.coordinateSystem = value; this.refreshMenu('Coordinates'); }
			},
			...coordinateDimensions(this.view.region, this.view.coordinateSystem).map((label, index) => ({
				label, value: this.view.axes[index], options: dimensions.map((name, value) => ({ value, label: name })),
				action: value => { this.view.setAxis(index, Number(value)); this.refreshMenu(label); }
			}))
		] };
	}

	contextItems() {
		const options = [
			{ label: 'Bars', input: 'number', min: 0, value: this.barCount, action: value => { this.barCount = value; } },
			{ label: 'Cell', items: ['entropy', 'brightness', 'character', 'hex'].map(shader => ({
				label: { character: 'Character', hex: 'Hex', entropy: 'Entropy', brightness: 'Brightness' }[shader],
				kind: 'checkbox',
				checked: this.view.shaders.includes(shader),
				action: () => {
					const active = this.view.shaders;
					this.view.shaders = active.includes(shader) ? active.filter(value => value !== shader) : [...active, shader];
				}
			})) },
			{ label: 'Character', items: [
				{ label: 'Encoding', value: this.view.encoding,
					options: [{ value: 'ascii', label: 'ASCII' }, { value: 'ascii-overbar', label: 'ASCII + Overbar' }, { value: 'cp437', label: 'CP437' }, { value: 'latin1', label: 'Latin-1' }],
					action: value => { this.view.encoding = value; }
				},
				...['blankSpaces', 'blankNulls'].map(option => ({
					label: option === 'blankSpaces' ? 'Blank Spaces' : 'Blank Nulls',
					kind: 'checkbox', checked: this.view[option],
					action: () => { this.view[option] = !this.view[option]; }
				}))
			] },
			{ label: 'Region', items: ['linear', 'hilbert', 'digraph', 'dft', 'trigraph'].map(region => ({
				label: { linear: 'Linear', hilbert: 'Hilbert', digraph: 'Digraph', dft: 'DFT', trigraph: 'Trigraph' }[region],
				checked: this.view.region === region,
				action: () => { this.view.region = region; }
			})) }
		];
		const [bars, cell, character, region] = options;
		const grid = ['linear', 'hilbert'].includes(this.view.region);
		return [bars, region, this.coordinateMenu(),
			...(grid ? [cell] : []),
			...(grid && this.view.shaders.includes('character') ? [character] : []),
			...(this.view.region === 'trigraph' ? [{ label: 'Camera', items: [
				{ label: 'Frequency as Opacity', kind: 'checkbox', checked: this.view.frequencyOpacity, action: () => {
					this.view.frequencyOpacity = !this.view.frequencyOpacity;
				} }, { label: 'Reset Rotation', action: () => {
				this.view.rotation = { yaw: -0.6, pitch: 0.45 };
				this.view.render();
			} }] }] : [])
		];
	}

	get barCount() { return this.levels.length; }

	set barCount(count) {
		if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Bar count must be a non-negative integer');
		for (const level of this.levels) { level.bar.stopAuto(); level.bar.remove(); }
		this.levels = Array.from({ length: count }, (_, index) => {
			const bar = new DataScrollBar();
			const level = { bar, offset: 0, requested: this.windowSize };
			bar.addEventListener('seek', event => {
				level.offset = event.detail;
				this.updateLevels();
			});
			bar.addEventListener('window-change', event => {
				level.requested = event.detail.length;
				level.offset = event.detail.offset;
				if (index === this.levels.length - 1) this.windowSize = level.requested;
				this.wheelRows = 0;
				this.updateLevels(level, event.detail.edge === 'top' ? event.detail.offset + event.detail.length : undefined);
			});
			return level;
		});
		this.bar = this.levels.at(-1)?.bar;
		this.barContainer.append(...this.levels.map(level => level.bar).reverse());
		if (this.source) this.resetLevels(this.offset);
	}

	set source(source) {
		this._source = source instanceof Blob ? source : new Blob([source]);
		for (const level of this.levels) level.bar.stopAuto();
		this.resetLevels(0);
	}

	get source() { return this._source; }

	resetLevels(offset) {
		let base = 0, size = this.source.size;
		this.levels.forEach((level, index) => {
			level.requested = index === this.levels.length - 1 ? this.windowSize
				: Math.min(size, Math.max(this.windowSize, Math.ceil(size / 4)));
			const length = Math.min(size, level.requested);
			level.offset = clamp(offset - base, 0, size - length);
			base += level.offset;
			size = length;
		});
		this.updateLevels();
	}

	updateLevels(changed, anchorEnd) {
		if (!this.source) return;
		this.view.wholeBuffer = this.levels.length === 0;
		if (this.view.wholeBuffer) {
			this.offset = 0;
			const layout = { ...this.view.layout(this.source.size, this.source.size), limit: this.source.size };
			this.view.requestedLength = this.source.size;
			this.view.setWindow(this.source, 0, this.source.size, layout);
			return;
		}
		let source = this.source, base = 0;
		this.levels.forEach((level, index) => {
			const inner = index === this.levels.length - 1;
			const limit = Math.min(source.size, level === changed ? anchorEnd ?? source.size : source.size);
			const layout = inner ? { ...this.view.layout(this.windowSize, limit), limit } : null;
			const length = inner ? layout.length : Math.min(source.size, Math.max(1, Math.round(level.requested)));
			if (level === changed && anchorEnd !== undefined) level.offset = anchorEnd - length;
			level.offset = clamp(Math.round(level.offset), 0, source.size - length);
			level.base = base;
			level.length = length;
			level.bar.setWindow(source, level.offset, length, { source: this.source, offset: base });
			if (inner) {
				this.offset = base + level.offset;
				this.view.requestedLength = this.windowSize;
				this.view.setWindow(this.source, this.offset, length, layout);
			} else {
				if (level.sliceSource !== source || level.sliceOffset !== level.offset || level.sliceLength !== length) {
					level.sliceSource = source;
					level.sliceOffset = level.offset;
					level.sliceLength = length;
					level.slice = source.slice(level.offset, level.offset + length);
				}
				base += level.offset;
				source = level.slice;
			}
		});
	}

	seek(offset, anchorEnd) {
		if (!this.source) return;
		const level = this.levels.at(-1);
		if (!level) { this.updateLevels(); return; }
		level.offset = offset - (level.base || 0);
		this.updateLevels(level, anchorEnd === undefined ? undefined : anchorEnd - (level.base || 0));
	}

}

customElements.define('ui-popup', Popup);
customElements.define('context-menu', ContextMenu);
customElements.define('data-scroll-view', DataScrollView);
customElements.define('data-scroll-bar', DataScrollBar);
customElements.define('data-scroll', DataScroll);

function onDOMContentLoaded() {
	const scroll = new DataScroll();
	document.body.append(scroll);
	let pending;
	async function load() {
		pending?.abort();
		const request = pending = new AbortController();
		try {
			const path = location.hash.slice(1) || './cat';
			const response = await fetch(new URL(path, document.baseURI), { signal: request.signal });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const source = await response.blob();
			if (!request.signal.aborted) scroll.source = source;
		} catch (error) {
			if (!request.signal.aborted) console.error('Unable to load binary data:', error);
		}
	}
	window.addEventListener('hashchange', load);
	return load();
}

document.addEventListener('DOMContentLoaded', onDOMContentLoaded);
