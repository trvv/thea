const PAGE_SIZE = 65536;
const MAX_PAGES = 64;

// Prefix sums make exact byte-range averages reusable as nested bars move.
// Each page is bounded to 256 KiB; the LRU retains at most 16 MiB per bar.
export async function overviewValues(job, cache, current = () => true) {
	const sameSource = cache.overview && (job.sourceId === undefined
		? cache.overview.source === job.source : cache.overview.sourceId === job.sourceId);
	if (!sameSource) cache.overview = { source: job.source, sourceId: job.sourceId, pages: new Map() };
	const pages = cache.overview.pages;
	const count = job.width * job.height;
	const values = new Uint8Array(count);
	const length = job.length ?? job.source.size;
	const base = job.offset || 0;
	let pageIndex = -1, prefix, previous = 0, bytesRead = 0, duration = 0;
	let started = performance.now();
	for (let pixel = 0; pixel < count; pixel++) {
		const start = Math.ceil(pixel * length / count);
		const end = Math.ceil((pixel + 1) * length / count);
		let sum = 0;
		for (let offset = base + start; offset < base + end;) {
			const page = Math.floor(offset / PAGE_SIZE);
			if (page !== pageIndex) {
				prefix = pages.get(page);
				if (!prefix) {
					duration += performance.now() - started;
					const bytes = new Uint8Array(await job.source.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).arrayBuffer());
					if (!current()) return null;
					if (!bytes.length) throw new Error('Byte source ended before its declared size.');
					started = performance.now();
					prefix = new Uint32Array(bytes.length + 1);
					for (let i = 0; i < bytes.length; i++) prefix[i + 1] = prefix[i] + bytes[i];
					bytesRead += bytes.length;
				}
				pages.delete(page);
				pages.set(page, prefix);
				if (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value);
				pageIndex = page;
			}
			const left = offset - page * PAGE_SIZE;
			const right = Math.min(prefix.length - 1, base + end - page * PAGE_SIZE);
			if (right <= left) throw new Error('Byte source ended before its declared size.');
			sum += prefix[right] - prefix[left];
			offset += right - left;
		}
		if (end > start) previous = sum / (end - start);
		values[pixel] = previous;
	}
	duration += performance.now() - started;
	return current() ? { values, duration, bytesRead } : null;
}
