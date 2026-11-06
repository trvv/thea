/** Engine-local bounded pages. Source identity and absolute addresses define reuse. */
import { readProviderBytes } from "./provider-diagnostics.js";
import { windowEntropy } from "./entropy.js";

const pageSize = 65536;
export function providerPages(cache, source, identity, budget = 8 * 1048576) {
  const owner = cache.sharedAnalysis || cache;
  if (cache.sharedAnalysis) identity = source;
  if (owner.providerPages?.source !== identity)
    owner.providerPages = { source: identity, entries: new Map(), bytes: 0 };
  const state = (cache.providerPages = owner.providerPages);
  const trim = () => {
    while (state.bytes > budget && state.entries.size) {
      const key = state.entries.keys().next().value;
      state.bytes -= state.entries.get(key).byteLength;
      state.entries.delete(key);
    }
  };
  trim();
  async function page(index, window, diagnostics, current) {
    const key = `${index}/${window}`;
    const previous = state.entries.get(key);
    if (previous) {
      state.entries.delete(key);
      state.entries.set(key, previous);
      return previous;
    }
    state.pending ||= new Map();
    if (state.pending.has(key)) return state.pending.get(key);
    // A page is immutable source work, so cancellation of one waiter cannot poison others.
    const pending = fillPage(index, window, diagnostics);
    state.pending.set(key, pending);
    try {
      return await pending;
    } finally {
      state.pending.delete(key);
    }
  }
  async function fillPage(index, window, diagnostics) {
    const key = `${index}/${window}`;
    const start = index * pageSize;
    const end = Math.min(source.size, start + pageSize);
    let value;
    if (!window) {
      value = await readProviderBytes(source, start, end, diagnostics);
      if (value.length !== end - start)
        throw new Error("Byte source ended before its declared size.");
    } else {
      const left = Math.max(0, start - Math.floor(window / 2));
      const right = Math.min(
        source.size,
        end + window - Math.floor(window / 2) - 1,
      );
      const bytes = await range(left, right, 0, diagnostics, () => true);
      value = windowEntropy(bytes, window, window === 32).slice(
        start - left,
        end - left,
      );
    }
    if (value.byteLength <= budget) {
      state.entries.set(key, value);
      state.bytes += value.byteLength;
      trim();
    }
    return value;
  }
  async function range(start, end, window, diagnostics, current) {
    const result =
      window && window !== 32
        ? new Float32Array(end - start)
        : new Uint8Array(end - start);
    for (let offset = start; offset < end;) {
      const index = Math.floor(offset / pageSize);
      const value = await page(index, window, diagnostics, current);
      if (!value || !current()) return null;
      const first = offset - index * pageSize;
      const length = Math.min(value.length - first, end - offset);
      result.set(value.subarray(first, first + length), offset - start);
      offset += length;
    }
    return result;
  }
  return { range };
}
