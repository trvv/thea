/** Exact sparse preparation for statically addressed byte and entropy lookups. */
import { windowEntropy } from "./entropy.js";
import { readProviderBytes, recordProvider } from "./provider-diagnostics.js";
import { assertProviderBudget } from "./provider-budget.js";

const maximumSparseBytes = 16 * 1024 * 1024;
const supportedAddresses = new Set([
  "constant",
  "offset",
  "length",
  "pointIndex",
  "pointCount",
  "add",
  "subtract",
  "multiply",
  "divide",
  "floor",
  "abs",
  "fract",
  "invert",
  "normalize",
  "clamp",
  "power",
]);

function addressEvaluator(program) {
  const staticNodes = new Map();
  const isStatic = (id) => {
    if (staticNodes.has(id)) return staticNodes.get(id);
    const node = program.nodes[id];
    const valid = supportedAddresses.has(node.op) && node.args.every(isStatic);
    staticNodes.set(id, valid);
    return valid;
  };
  const requests = program.nodes.filter(
    (node) => node.op === "byte" || node.op === "entropy",
  );
  if (requests.some((node) => !isStatic(node.args[0]))) return null;
  const values = new Map();
  let sampleOffset, sampleLength;
  const value = (id, offset, length) => {
    if (sampleOffset !== offset || sampleLength !== length) {
      values.clear();
      sampleOffset = offset;
      sampleLength = length;
    }
    if (values.has(id)) return values.get(id);
    const node = program.nodes[id];
    const a = node.args.length ? value(node.args[0], offset, length) : 0;
    const b = node.args.length > 1 ? value(node.args[1], offset, length) : 0;
    let result;
    switch (node.op) {
      case "constant":
        result = node.value;
        break;
      case "offset":
      case "pointIndex":
        result = offset;
        break;
      case "length":
      case "pointCount":
        result = length;
        break;
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        result = b === 0 ? 0 : a / b;
        break;
      case "floor":
        result = Math.floor(a);
        break;
      case "abs":
        result = Math.abs(a);
        break;
      case "fract":
        result = a - Math.floor(a);
        break;
      case "invert":
        result = 1 - a;
        break;
      case "normalize":
        result = Math.max(
          0,
          Math.min(1, (a - node.min) / (node.max - node.min)),
        );
        break;
      case "clamp":
        result = Math.max(node.min, Math.min(node.max, a));
        break;
      case "power":
        result = Math.max(0, a) ** node.exponent;
        break;
    }
    if (node.type === "index") {
      if (!Number.isSafeInteger(result))
        throw new RangeError("Recipe index exceeds the safe integer range");
      values.set(id, result);
      return result;
    }
    const rounded = Math.fround(result);
    values.set(id, rounded);
    return rounded;
  };
  return { requests, value };
}

/** Undefined means the dense reference remains more appropriate; null means superseded. */
export async function prepareSparseProviders(
  job,
  program,
  used,
  windows,
  count,
  cache,
  current,
  diagnostics,
) {
  if (
    job.sparseProviders === false ||
    job.length <= 65536 ||
    !count ||
    count > 16384 ||
    program.providers.numeric ||
    program.providers.analysis?.length
  )
    return undefined;
  const addresses = addressEvaluator(program);
  if (!addresses) return undefined;
  if (count * (5 + addresses.requests.length) > 65536) return undefined;
  const key = `${job.offset}/${job.length}/${count}/${program.key}/${[...used].join(",")}`;
  const source = job.sourceId ?? job.source;
  if (cache.factorSparse?.source === source && cache.factorSparse.key === key) {
    recordProvider(
      diagnostics,
      "sparse",
      diagnostics ? performance.now() : 0,
      false,
    );
    return cache.factorSparse;
  }
  const started = diagnostics ? performance.now() : 0;
  const intervals = [];
  const entropyIndices = new Map([...windows].map((size) => [size, new Set()]));
  const addByte = (index) => {
    index = Math.floor(index);
    if (index >= 0 && index < job.length)
      intervals.push([job.offset + index, job.offset + index + 1]);
  };
  const addEntropy = (index, size) => {
    index = Math.floor(index);
    if (!(index >= 0 && index < job.length)) return;
    entropyIndices.get(size).add(index);
    const center = job.offset + index;
    intervals.push([
      Math.max(0, center - Math.floor(size / 2)),
      Math.min(job.source.size, center + size - Math.floor(size / 2)),
    ]);
  };
  for (let i = 0; i < count; i++) {
    const offset = Math.floor((i * job.length) / count);
    // Keep the origin available for inspection even if only another lookup is active.
    addByte(offset);
    if (used.has("byte2")) addByte(offset + 1);
    if (used.has("byte3")) addByte(offset + 2);
    if (used.has("previous")) addByte(offset - 1);
    if (used.has("entropy")) addEntropy(offset, 32);
    for (const request of addresses.requests) {
      const index = addresses.value(request.args[0], offset, job.length);
      if (request.op === "byte") addByte(index);
      else addEntropy(index, request.window);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const ranges = [];
  let total = 0;
  for (const [start, end] of intervals) {
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) {
      total += Math.max(0, end - previous.end);
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
      total += end - start;
    }
    if (total > maximumSparseBytes || total >= job.length / 2) return undefined;
  }
  // Map/object overhead is engine-dependent; the budget uses a conservative explicit estimate.
  const entries = [...entropyIndices.values()].reduce(
    (sum, indices) => sum + indices.size,
    0,
  );
  const temporaryBytes =
    Math.max(0, ...ranges.map((range) => range.end - range.start)) * 4;
  assertProviderBudget(
    job,
    total + entries * 64 + ranges.length * 64 + temporaryBytes,
    "Sparse byte and entropy preparation",
  );
  for (const range of ranges) {
    range.data = await readProviderBytes(
      job.source,
      range.start,
      range.end,
      diagnostics,
    );
    if (!current()) return null;
    if (range.data.length !== range.end - range.start)
      throw new Error("Byte source ended before its declared size.");
  }
  const containingRange = (absolute) => {
    let first = 0,
      last = ranges.length;
    while (first < last) {
      const middle = Math.floor((first + last) / 2);
      if (ranges[middle].end <= absolute) first = middle + 1;
      else last = middle;
    }
    const range = ranges[first];
    return range && range.start <= absolute ? range : undefined;
  };
  const entropyValues = new Map();
  for (const [size, indices] of entropyIndices) {
    const values = new Map();
    // Each merged range contains the complete root-context halo of its requested centers.
    // Temporary rolling arrays are released; only requested scalar values are retained.
    let previousRange, prepared;
    for (const index of [...indices].sort((a, b) => a - b)) {
      const absolute = job.offset + index;
      const range = containingRange(absolute);
      if (range !== previousRange) {
        prepared = windowEntropy(range.data, size, size === 32);
        previousRange = range;
      }
      values.set(index, prepared[absolute - range.start]);
    }
    entropyValues.set(size, values);
  }
  const sparse = {
    source,
    key,
    ranges,
    entropyValues,
    byte(index) {
      index = Math.floor(index);
      if (!(index >= 0 && index < job.length)) return 0;
      const absolute = job.offset + index;
      const range = containingRange(absolute);
      if (!range) throw new Error("Unprepared sparse byte address.");
      return range.data[absolute - range.start];
    },
    entropy(index, size) {
      index = Math.floor(index);
      if (!(index >= 0 && index < job.length)) return 0;
      const value = entropyValues.get(size)?.get(index);
      if (value === undefined)
        throw new Error("Unprepared sparse entropy address.");
      return size === 32 ? Math.fround(value / 255) : value;
    },
    quantizedEntropy(index) {
      return entropyValues.get(32)?.get(index) ?? 0;
    },
    rootRange(start, end) {
      const range = containingRange(start);
      if (!range || range.end < end)
        throw new Error("Unprepared sparse source range.");
      return range.data.subarray(start - range.start, end - range.start);
    },
  };
  if (!current()) return null;
  cache.factorSparse = sparse;
  // Releasing dense local caches makes switching to sparse preparation actually release storage.
  delete cache.factorWindow;
  delete cache.factorEntropy;
  delete cache.recipeEntropy;
  recordProvider(diagnostics, "sparse", started, true);
  return sparse;
}
