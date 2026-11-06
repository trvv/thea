/** Exact user-trained reference distributions and versioned, source-independent model artifacts. */
import { scanChunkSize, yieldScan } from "../data/scan.js";
import { readProviderBytes } from "../data/provider-diagnostics.js";

export const storageKey = "thea.referenceModels";
export const defaultLibraryBudget = 1024 * 1024;
const maximumModels = 64;

const nameOf = (name) => {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
    throw new TypeError("Reference names must contain 1–80 characters");
  return name.trim();
};
const token = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
const integer = (value, minimum, maximum, label) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`Invalid ${label}`);
  return value;
};
function priorOf(value) {
  if (!Number.isFinite(value) || value < 1e-6 || value > 1e6)
    throw new TypeError("Prior mass must be between 0.000001 and 1000000");
  return value;
}
function provenanceOf(value = {}, byteCount) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid reference provenance");
  const result = {};
  for (const field of ["label", "sourceIdentity"])
    if (value[field] !== undefined) {
      if (typeof value[field] !== "string" || value[field].length > 2048)
        throw new TypeError(`Invalid reference ${field}`);
      result[field] = value[field];
    }
  if (value.sourceRange !== undefined) {
    const { start, endExclusive } = value.sourceRange || {};
    integer(start, 0, Number.MAX_SAFE_INTEGER, "training start");
    integer(endExclusive, start, Number.MAX_SAFE_INTEGER, "training end");
    if (endExclusive - start !== byteCount)
      throw new TypeError("Training range must match its byte count");
    result.sourceRange = { start, endExclusive };
  }
  return result;
}

/** Validate every count, scope and parameter; return owned JSON data, never runtime lookup tables. */
export function validateModel(value) {
  if (!value || value.version !== 1)
    throw new TypeError("Unsupported reference model version");
  if (
    typeof value.id !== "string" ||
    !value.id.startsWith("reference:") ||
    value.id.length > 128
  )
    throw new TypeError("Invalid reference model ID");
  if (
    typeof value.revision !== "string" ||
    !value.revision ||
    value.revision.length > 128
  )
    throw new TypeError("Invalid reference model revision");
  const name = nameOf(value.name);
  const order = integer(value.order, 1, 2, "reference order");
  const priorMass = priorOf(value.priorMass);
  const byteCount = integer(
    value.training?.byteCount,
    order,
    Number.MAX_SAFE_INTEGER,
    "training byte count",
  );
  const itemCount = integer(
    value.training?.itemCount,
    1,
    Number.MAX_SAFE_INTEGER,
    "training item count",
  );
  if (itemCount !== byteCount - order + 1)
    throw new TypeError("Training item count does not match byte count/order");
  const alphabet = 256 ** order;
  if (!Array.isArray(value.counts) || value.counts.length !== alphabet)
    throw new TypeError("Reference count table has the wrong alphabet size");
  let sum = 0;
  const counts = value.counts.map((count) => {
    integer(count, 0, itemCount, "reference count");
    sum += count;
    if (!Number.isSafeInteger(sum) || sum > itemCount)
      throw new TypeError("Reference counts exceed training items");
    return count;
  });
  if (sum !== itemCount)
    throw new TypeError("Reference counts do not sum to training items");
  return {
    version: 1,
    id: value.id,
    revision: value.revision,
    name,
    order,
    priorMass,
    counts,
    training: {
      byteCount,
      itemCount,
      provenance: provenanceOf(value.training.provenance, byteCount),
    },
  };
}

/** Fit a byte or overlapping adjacent-pair distribution, yielding between bounded chunks. */
export async function trainReference(
  { bytes, name, order = 1, priorMass = 1, provenance = {}, id },
  current = () => true,
) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("Training bytes must be Uint8Array");
  integer(order, 1, 2, "reference order");
  if (bytes.length < order)
    throw new TypeError("Reference training needs at least one complete item");
  name = nameOf(name);
  priorMass = priorOf(priorMass);
  const trainingProvenance = provenanceOf(provenance, bytes.length);
  if (!current()) return null;
  const counts = new Float64Array(256 ** order);
  let previous = 0;
  for (let offset = 0; offset < bytes.length; offset += scanChunkSize) {
    const end = Math.min(bytes.length, offset + scanChunkSize);
    for (let i = offset; i < end; i++) {
      const byte = bytes[i];
      if (order === 1) counts[byte]++;
      else if (i) counts[previous * 256 + byte]++;
      previous = byte;
    }
    if (end < bytes.length && !(await yieldScan(current))) return null;
  }
  if (!current()) return null;
  return validateModel({
    version: 1,
    id: id ?? `reference:${token()}`,
    revision: token(),
    name,
    order,
    priorMass,
    counts: [...counts],
    training: {
      byteCount: bytes.length,
      itemCount: bytes.length - order + 1,
      provenance: trainingProvenance,
    },
  });
}

/** Fit a Blob interval without allocating the complete training selection. */
export async function trainReferenceSource(
  {
    source,
    start = 0,
    end = source.size,
    name,
    order = 1,
    priorMass = 1,
    provenance,
    id,
  },
  current = () => true,
) {
  integer(start, 0, source.size, "training start");
  integer(end, start, source.size, "training end");
  integer(order, 1, 2, "reference order");
  if (end - start < order)
    throw new TypeError("Reference training needs a complete item");
  name = nameOf(name);
  priorMass = priorOf(priorMass);
  const trainingProvenance = provenanceOf(
    provenance ?? { sourceRange: { start, endExclusive: end } },
    end - start,
  );
  if (!current()) return null;
  const counts = new Float64Array(256 ** order);
  let previous = 0,
    seen = 0;
  for (let offset = start; offset < end;) {
    const limit = Math.min(end, offset + scanChunkSize);
    const bytes = await readProviderBytes(source, offset, limit);
    if (!current()) return null;
    if (bytes.length !== limit - offset)
      throw new Error("Training source ended before its declared size");
    for (const byte of bytes) {
      if (order === 1) counts[byte]++;
      else if (seen) counts[previous * 256 + byte]++;
      previous = byte;
      seen++;
    }
    offset = limit;
    if (offset < end && !(await yieldScan(current))) return null;
  }
  if (!current()) return null;
  return validateModel({
    version: 1,
    id: id ?? `reference:${token()}`,
    revision: token(),
    name,
    order,
    priorMass,
    counts: [...counts],
    training: {
      byteCount: end - start,
      itemCount: end - start - order + 1,
      provenance: trainingProvenance,
    },
  });
}

/** Prepare once per artifact revision, outside point evaluation. The table stores negative log2 probabilities. */
export function prepareReference(value) {
  const model = validateModel(value);
  const alphabet = model.counts.length;
  const prior = model.priorMass / alphabet;
  const denominator = model.training.itemCount + model.priorMass;
  const negativeLogProbabilities = Float64Array.from(
    model.counts,
    (count) => -Math.log2((count + prior) / denominator),
  );
  return { model, negativeLogProbabilities };
}

/** Score one explicit byte interval. This is descriptive resemblance, not calibrated class probability. */
export function scorePreparedReference(
  prepared,
  bytes,
  { start = 0, end = bytes.length, minItems = 1 } = {},
) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("Scoring bytes must be Uint8Array");
  integer(start, 0, bytes.length, "score start");
  integer(end, start, bytes.length, "score end");
  integer(minItems, 1, Number.MAX_SAFE_INTEGER, "minimum evidence");
  const { model, negativeLogProbabilities } = prepared;
  const itemCount = Math.max(0, end - start - model.order + 1);
  let bits = 0;
  let seenCount = 0;
  for (let offset = start; offset + model.order <= end; offset++) {
    const key =
      model.order === 1
        ? bytes[offset]
        : bytes[offset] * 256 + bytes[offset + 1];
    bits += negativeLogProbabilities[key];
    if (model.counts[key]) seenCount++;
  }
  return {
    modelID: model.id,
    revision: model.revision,
    name: model.name,
    order: model.order,
    sourceRange: { start, endExclusive: end },
    training: model.training,
    priorMass: model.priorMass,
    itemCount,
    seenCount,
    coverage: itemCount ? seenCount / itemCount : 0,
    negativeLogLikelihood: itemCount ? bits / itemCount : null,
    totalBits: bits,
    valid: itemCount >= minItems,
  };
}

export function scoreModel(model, bytes, options) {
  return scorePreparedReference(prepareReference(model), bytes, options);
}

/** Rank only comparable gram orders and retain explicit unknown/insufficient/tie states. */
export function scoreReferences(
  models,
  bytes,
  { minItems = 16, minMargin = 0.25, minCoverage = 0, ...scope } = {},
) {
  if (!Array.isArray(models) || !models.length || models.length > maximumModels)
    throw new TypeError("Provide between 1 and 64 reference models");
  if (!Number.isFinite(minMargin) || minMargin < 0 || minMargin > 1e6)
    throw new TypeError("Invalid reference score margin");
  if (!Number.isFinite(minCoverage) || minCoverage < 0 || minCoverage > 1)
    throw new TypeError("Invalid reference coverage threshold");
  const prepared = models.map(prepareReference);
  if (new Set(prepared.map((value) => value.model.order)).size !== 1)
    throw new TypeError("Reference comparisons require the same gram order");
  if (new Set(prepared.map((value) => value.model.id)).size !== prepared.length)
    throw new TypeError("Duplicate reference model IDs");
  const scores = prepared.map((value) =>
    scorePreparedReference(value, bytes, { ...scope, minItems }),
  );
  scores.sort(
    (a, b) =>
      (a.negativeLogLikelihood ?? Infinity) -
        (b.negativeLogLikelihood ?? Infinity) ||
      a.modelID.localeCompare(b.modelID),
  );
  const best = scores[0];
  const margin =
    scores.length > 1 && best.negativeLogLikelihood !== null
      ? scores[1].negativeLogLikelihood - best.negativeLogLikelihood
      : null;
  const status = !best.valid
    ? "insufficient"
    : best.seenCount === 0 || best.coverage < minCoverage
      ? "unseen"
      : scores.length === 1
        ? "scored"
        : margin === 0 || margin < minMargin
          ? "ambiguous"
          : "match";
  return {
    order: best.order,
    scores,
    status,
    bestModelID: best.valid ? best.modelID : null,
    winnerID: status === "match" ? best.modelID : null,
    margin,
    evidence: best.itemCount,
    parameters: { minItems, minMargin, minCoverage },
  };
}

function budgetOf(maxBytes) {
  return integer(
    maxBytes,
    1,
    Number.MAX_SAFE_INTEGER,
    "reference library budget",
  );
}
function checkTextBudget(text, maxBytes) {
  budgetOf(maxBytes);
  if (
    text.length > maxBytes ||
    new TextEncoder().encode(text).byteLength > maxBytes
  )
    throw new RangeError(`Reference JSON exceeds the ${maxBytes}-byte budget`);
}
function validateLibrary(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.models) ||
    value.models.length > maximumModels
  )
    throw new TypeError("Unsupported or damaged reference library");
  const models = value.models.map(validateModel);
  if (
    new Set(models.map((model) => model.id)).size !== models.length ||
    new Set(models.map((model) => model.name)).size !== models.length
  )
    throw new TypeError("Duplicate reference ID or name");
  return { version: 1, models };
}
export function readLibrary(
  storage = globalThis.localStorage,
  { maxBytes = defaultLibraryBudget } = {},
) {
  const json = storage?.getItem(storageKey);
  if (json == null) return { version: 1, models: [] };
  checkTextBudget(json, maxBytes);
  return validateLibrary(JSON.parse(json));
}
function writeLibrary(value, storage, maxBytes) {
  if (!storage?.setItem) throw new Error("Reference storage is unavailable");
  const library = validateLibrary(value);
  const json = JSON.stringify(library);
  checkTextBudget(json, maxBytes);
  storage.setItem(storageKey, json);
  return library;
}
export function saveModel(
  value,
  storage = globalThis.localStorage,
  { maxBytes = defaultLibraryBudget } = {},
) {
  const model = validateModel(value);
  const library = readLibrary(storage, { maxBytes });
  const index = library.models.findIndex((entry) => entry.id === model.id);
  const duplicate = library.models.find(
    (entry) => entry.name === model.name && entry.id !== model.id,
  );
  if (duplicate)
    throw new TypeError("A reference with that name already exists");
  if (index < 0) library.models.push(model);
  else library.models[index] = model;
  writeLibrary(library, storage, maxBytes);
  return structuredClone(model);
}
export function renameModel(
  id,
  name,
  storage = globalThis.localStorage,
  { maxBytes = defaultLibraryBudget } = {},
) {
  const library = readLibrary(storage, { maxBytes });
  const model = library.models.find((entry) => entry.id === id);
  if (!model) throw new TypeError("Unknown reference model");
  model.name = nameOf(name);
  model.revision = token();
  writeLibrary(library, storage, maxBytes);
  return structuredClone(model);
}
export function deleteModel(
  id,
  storage = globalThis.localStorage,
  { maxBytes = defaultLibraryBudget } = {},
) {
  const library = readLibrary(storage, { maxBytes });
  const index = library.models.findIndex((entry) => entry.id === id);
  if (index < 0) throw new TypeError("Unknown reference model");
  const [model] = library.models.splice(index, 1);
  writeLibrary(library, storage, maxBytes);
  return model;
}
export const serializeModel = (model) => JSON.stringify(validateModel(model));
export function parseModel(json, { maxBytes = defaultLibraryBudget } = {}) {
  if (typeof json !== "string")
    throw new TypeError("Reference JSON must be a string");
  checkTextBudget(json, maxBytes);
  return validateModel(JSON.parse(json));
}

const resolvedLibraries = new WeakMap();
/** Resolve only reachable IDs; unchanged storage reuses immutable validated artifacts. */
export function resolveModels(ids, storage) {
  if (!ids.length) return [];
  storage ??= globalThis.localStorage;
  if (!storage?.getItem) throw new Error("Reference storage is unavailable");
  const json = storage.getItem(storageKey);
  let cached = resolvedLibraries.get(storage);
  if (!cached || cached.json !== json) {
    if (json !== null) checkTextBudget(json, defaultLibraryBudget);
    const library =
      json === null ? { models: [] } : validateLibrary(JSON.parse(json));
    for (const model of library.models) {
      Object.freeze(model.counts);
      if (model.training.provenance.sourceRange)
        Object.freeze(model.training.provenance.sourceRange);
      Object.freeze(model.training.provenance);
      Object.freeze(model.training);
      Object.freeze(model);
    }
    cached = { json, models: library.models };
    resolvedLibraries.set(storage, cached);
  }
  return [...new Set(ids)].map((id) => {
    const model = cached.models.find((model) => model.id === id);
    if (!model) throw new Error(`Reference model is unavailable: ${id}`);
    return model;
  });
}
