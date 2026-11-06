/** Incremental exact tuple membership and first/last representatives, without per-occurrence lists. */
import { readProviderBytes } from "./provider-diagnostics.js";
import { assertProviderBudget } from "./provider-budget.js";
import { scanChunkSize, mapEntryEstimate, yieldScan } from "./scan.js";

const difference = (start, end, otherStart, otherEnd) =>
  [
    [start, Math.min(end, otherStart)],
    [Math.max(start, otherEnd), end],
  ].filter(([first, last]) => first < last);

export async function tupleIndex(
  job,
  bytes,
  cache,
  width,
  current,
  diagnostics,
) {
  const source = job.sourceId ?? job.source;
  const start = job.offset;
  const end = start + Math.max(0, job.length - width + 1);
  const old = cache.tupleIndex;
  if (
    old?.disabled &&
    old.source === source &&
    old.width === width &&
    Math.min(old.end, end) > Math.max(old.start, start)
  )
    return undefined;
  if (
    old?.source === source &&
    old.width === width &&
    old.start === start &&
    old.end === end
  ) {
    assertProviderBudget(
      job,
      old.entries.size * (mapEntryEstimate + 32),
      "Tuple representative index",
    );
    return old;
  }
  const overlap =
    old?.source === source && old.width === width
      ? Math.max(0, Math.min(end, old.end) - Math.max(start, old.start))
      : 0;
  const changed = old
    ? end - start + old.end - old.start - 2 * overlap
    : Infinity;
  const incremental =
    overlap > 0 && changed <= scanChunkSize && changed < end - start;
  const initialBytes =
    Math.min(job.length, scanChunkSize) +
    width -
    1 +
    (incremental ? old.entries.size * 2 * (mapEntryEstimate + 32) : 0);
  if (initialBytes > (job.configuration.providerBudget ?? Infinity))
    return undefined;
  const entries = incremental ? new Map(old.entries) : new Map();
  let dense = false;
  let prefix;
  const touched = new Set();
  const checkBudget = () =>
    assertProviderBudget(
      job,
      Math.min(job.length, scanChunkSize) +
        width -
        1 +
        (entries.size * (incremental ? 2 : 1) + touched.size) *
          (mapEntryEstimate + 32),
      "Tuple representative index (estimated Map storage)",
    );
  checkBudget();
  async function scan(
    first,
    last,
    visit,
    reverse = false,
    initialChunkSize = scanChunkSize,
  ) {
    let chunkSize = initialChunkSize;
    for (
      let cursor = reverse ? last : first;
      reverse ? cursor > first : cursor < last;
    ) {
      const low = reverse
        ? Math.max(first, cursor - (chunkSize - width + 1))
        : cursor;
      const high = reverse
        ? cursor
        : Math.min(last, cursor + (chunkSize - width + 1));
      const chunk =
        bytes && low >= start && high + width - 1 <= start + bytes.length
          ? bytes.subarray(low - start, high - start + width - 1)
          : await readProviderBytes(
              job.source,
              low,
              high + width - 1,
              diagnostics,
            );
      if (!current()) return false;
      if (!incremental && low === start) prefix = chunk;
      if (chunk.length !== high - low + width - 1)
        throw new Error("Byte source ended before its declared size.");
      for (
        let index = reverse ? high - low - 1 : 0;
        reverse ? index >= 0 : index < high - low;
        reverse ? index-- : index++
      ) {
        const key =
          width === 1
            ? chunk[index]
            : width === 2
              ? chunk[index] * 256 + chunk[index + 1]
              : chunk[index] * 65536 +
                chunk[index + 1] * 256 +
                chunk[index + 2];
        if (visit(key, low + index) === false) return true;
      }
      cursor = reverse ? low : high;
      chunkSize = Math.min(scanChunkSize, chunkSize * 2);
      if (!(await yieldScan(current))) return false;
    }
    return current();
  }
  function update(key, address, delta) {
    let entry = entries.get(key);
    if (!touched.has(key)) {
      if (entry) entries.set(key, (entry = { ...entry }));
      touched.add(key);
      checkBudget();
    }
    if (!entry) {
      if (delta < 0) throw new Error("Tuple index lost an occurrence");
      entries.set(key, (entry = { first: address, last: address, count: 0 }));
      checkBudget();
    }
    if (width > 1 && entries.size > 4096) {
      dense = true;
      return false;
    }
    entry.count += delta;
    if (!entry.count) entries.delete(key);
    else if (delta > 0) {
      entry.first = Math.min(entry.first, address);
      entry.last = Math.max(entry.last, address);
    }
  }
  if (incremental) {
    for (const [first, last] of difference(old.start, old.end, start, end))
      if (
        !(await scan(first, last, (key, address) => update(key, address, -1)))
      )
        return null;
    for (const [first, last] of difference(start, end, old.start, old.end))
      if (!(await scan(first, last, (key, address) => update(key, address, 1))))
        return null;
    if (dense) {
      if (!current()) return null;
      cache.tupleIndex = { source, width, start, end, disabled: true };
      return undefined;
    }
    const missingFirst = new Set(),
      missingLast = new Set();
    for (const key of touched) {
      const entry = entries.get(key);
      if (!entry) continue;
      if (entry.first < start || entry.first >= end) missingFirst.add(key);
      if (entry.last < start || entry.last >= end) missingLast.add(key);
    }
    if (
      missingFirst.size &&
      !(await scan(
        start,
        end,
        (key, address) => {
          if (missingFirst.delete(key)) entries.get(key).first = address;
          return missingFirst.size > 0;
        },
        false,
        256,
      ))
    )
      return null;
    if (
      missingLast.size &&
      !(await scan(
        start,
        end,
        (key, address) => {
          if (missingLast.delete(key)) entries.get(key).last = address;
          return missingLast.size > 0;
        },
        true,
        256,
      ))
    )
      return null;
  } else if (
    !(await scan(start, end, (key, address) => update(key, address, 1)))
  )
    return null;
  if (!current()) return null;
  if (dense) {
    cache.tupleIndex = { source, width, start, end, disabled: true };
    if (prefix)
      cache.populationScanPrefix = { source, offset: start, data: prefix };
    return undefined;
  }
  // Existing first-encounter order survives for unchanged representatives. Merge only changed keys.
  let keys;
  if (width === 1) keys = Uint32Array.from(entries.keys()).sort();
  else if (!incremental) keys = Uint32Array.from(entries.keys());
  else {
    const stable = old.keys.filter(
      (key) =>
        entries.has(key) &&
        entries.get(key).first === old.entries.get(key).first,
    );
    const moved = Uint32Array.from(
      [...entries.keys()].filter(
        (key) =>
          !old.entries.has(key) ||
          entries.get(key).first !== old.entries.get(key).first,
      ),
    );
    moved.sort((a, b) => entries.get(a).first - entries.get(b).first);
    keys = new Uint32Array(entries.size);
    let left = 0,
      right = 0;
    for (let index = 0; index < keys.length; index++) {
      const takeLeft =
        left < stable.length &&
        (right === moved.length ||
          entries.get(stable[left]).first < entries.get(moved[right]).first);
      keys[index] = takeLeft ? stable[left++] : moved[right++];
    }
  }
  const state = { source, width, start, end, entries, keys, incremental };
  cache.tupleIndex = state;
  return state;
}
