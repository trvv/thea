// A small canvas double for checking render output and scheduling without a browser.
export class RenderCanvas {
	constructor(width = 1, height = 1) {
		this._width = width;
		this._height = height;
		this.resizes = 0;
		this.reset();
		const canvas = this;
		this.context = {
			getImageData: () => ({data: canvas.pixels.slice()}),
			createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
			putImageData(image) { canvas.pixels = image.data.slice(); },
			clearRect() { canvas.reset(); },
			drawImage(bitmap) { canvas.pixels = bitmap.pixels.slice(); canvas.commands = structuredClone(bitmap.commands); },
			fillRect(...rect) { canvas.commands.push(['rect', this.fillStyle, ...rect]); },
			fillText(...text) { canvas.commands.push(['text', this.fillStyle, this.font, this.textAlign, this.textBaseline, ...text]); }
		};
	}

	reset() { this.pixels = new Uint8ClampedArray(this.width * this.height * 4); this.commands = []; }
	get width() { return this._width; }
	set width(value) { this._width = value; this.resizes++; this.reset(); }
	get height() { return this._height; }
	set height(value) { this._height = value; this.resizes++; this.reset(); }
	getContext() { return this.context; }

	snapshot() { return { width: this.width, height: this.height, pixels: [...this.pixels], commands: this.commands }; }

	transferToImageBitmap() {
		return {
			width: this.width, height: this.height, pixels: this.pixels.slice(), commands: structuredClone(this.commands),
			closed: false, close() { this.closed = true; }
		};
	}
}
