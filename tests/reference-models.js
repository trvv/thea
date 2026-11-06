import assert from "node:assert/strict";
import * as references from "../src/analysis/reference-models.js";
import { executeRender } from "../src/render/rendering.js";
import { inspectPoint } from "../src/inspection/point-inspection.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { RenderCanvas } from "./render-canvas.js";
import { RenderEngine } from "../src/render/render-engine.js";

const low = await references.trainReference({
  bytes: Uint8Array.from({ length: 512 }, (_, i) => i % 4),
  name: "Low",
  provenance: { sourceRange: { start: 32, endExclusive: 544 } },
});
const high = await references.trainReference({
  bytes: Uint8Array.from({ length: 512 }, (_, i) => 252 + (i % 4)),
  name: "High",
});
const heldOut = Uint8Array.from({ length: 64 }, (_, i) => (i * 3) % 4);
const scores = references.scoreReferences([high, low], heldOut);
assert.equal(scores.winnerID, low.id);
assert(scores.margin > 0);
assert.equal(scores.status, "match");
assert.equal(scores.scores[0].coverage, 1);
assert.equal(
  references.scoreReferences([low, { ...low, id: "reference:other" }], heldOut)
    .status,
  "ambiguous",
);
assert.equal(
  references.scoreReferences([low, high], new Uint8Array(64).fill(50)).status,
  "unseen",
);
assert.equal(
  references.scoreReferences([low], Uint8Array.of(0), { minItems: 16 }).status,
  "insufficient",
);
const pair = await references.trainReference({
  bytes: Uint8Array.of(1, 2, 1, 2),
  name: "Pairs",
  order: 2,
});
const streamedBytes = Uint8Array.from(
  { length: 150000 },
  (_, index) => (index * 17) % 251,
);
const streamSource = new Blob([streamedBytes]);
const reads = [];
const trackedSource = {
  size: streamSource.size,
  slice(start, end) {
    reads.push([start, end]);
    return streamSource.slice(start, end);
  },
};
for (const order of [1, 2]) {
  const streamed = await references.trainReferenceSource({
    source: trackedSource,
    start: 13,
    end: 140013,
    order,
    name: "Streamed",
  });
  const buffered = await references.trainReference({
    bytes: streamedBytes.subarray(13, 140013),
    order,
    name: "Buffered",
  });
  assert.deepEqual(streamed.counts, buffered.counts);
  assert.equal(streamed.training.itemCount, buffered.training.itemCount);
}
assert(reads.every(([start, end]) => end - start <= 65536));
await assert.rejects(
  references.trainReferenceSource({
    source: { size: 10, slice: () => new Blob() },
    name: "Short",
  }),
  /ended/,
);
assert.equal(pair.counts[258], 2);
assert.equal(pair.counts[513], 1);
assert.throws(() => references.scoreReferences([low, pair], heldOut), /order/);
assert.throws(() => references.validateModel({ ...low, counts: [] }));
const damaged = structuredClone(low);
damaged.counts[0]++;
assert.throws(() => references.validateModel(damaged));
assert.deepEqual(references.parseModel(references.serializeModel(low)), low);
let calls = 0;
assert.equal(
  await references.trainReference(
    { bytes: new Uint8Array(200000), name: "Canceled" },
    () => ++calls < 3,
  ),
  null,
);

const entries = new Map();
const storage = {
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
};
references.saveModel(low, storage);
assert.deepEqual(references.resolveModels([low.id], storage), [low]);
const renamed = references.renameModel(low.id, "Renamed", storage);
assert.notEqual(renamed.revision, low.revision);
assert.equal(references.resolveModels([low.id], storage)[0].name, "Renamed");
const previous = entries.get(references.storageKey);
const full = {
  getItem: storage.getItem,
  setItem() {
    throw new Error("Quota");
  },
};
assert.throws(() => references.saveModel(high, full), /Quota/);
assert.equal(entries.get(references.storageKey), previous);
assert.throws(() => references.saveModel(high, storage, { maxBytes: 1 }));
references.deleteModel(low.id, storage);
assert.throws(() => references.resolveModels([low.id], storage), /unavailable/);
assert.equal(references.readLibrary(storage).models.length, 0);

const analysis = {
  op: "analysis",
  family: "reference",
  kind: "surprise",
  modelID: low.id,
  window: 16,
  offset: { op: "offset" },
};
const job = {
  kind: "view",
  source: new Blob([heldOut]),
  offset: 0,
  length: heldOut.length,
  columns: 64,
  rows: 64,
  region: "linear",
  configuration: {
    ...presetConfiguration("linear"),
    sampling: "representative",
  },
  appearance: {
    ...defaultAppearance("linear"),
    hue: { op: "normalize", input: analysis, min: 0, max: 16 },
  },
  sampleLayout: { columns: 8, rows: 8 },
  shaders: [],
  referenceModels: [low],
};
const cache = {};
await executeRender(new RenderCanvas(), job, cache);
const p = cache.pointRaster.projected;
const info = await inspectPoint(job, cache, p[0], p[1]);
const trace = info.nodes.find((node) => node.op === "analysis");
assert.equal(trace.source.modelID, low.id);
assert.equal(trace.source.itemCount, 8);
assert.equal(trace.source.coverage, 1);
const expected = references.scoreModel(low, heldOut, { start: 0, end: 8 });
assert.equal(trace.value, Math.fround(expected.negativeLogLikelihood));
await assert.rejects(
  executeRender(new RenderCanvas(), { ...job, referenceModels: [] }, {}),
  /unavailable/,
);
const modified = await references.trainReference({
  bytes: new Uint8Array(512).fill(255),
  name: low.name,
  id: low.id,
});
await executeRender(
  new RenderCanvas(),
  { ...job, referenceModels: [modified] },
  cache,
);
assert.equal(
  cache.analysisProviders.groups.values().next().value.reference.model.revision,
  modified.revision,
);
console.log(
  "Reference models pass: exact training, held-out scoring, uncertainty, evidence, atomic storage, artifact bounds, worker-safe recipes, revision freshness and provenance.",
);

const engine = new RenderEngine(new RenderCanvas(), {
  budget: 0,
  workerFactory: () => {
    const worker = new Worker(new URL("./render-thread.js", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", ({ data }) => {
      if (data.bitmap) data.bitmap.close = () => {};
    });
    return worker;
  },
});
const deadline = setTimeout(() => {
  engine.cancel();
  throw Error("Reference worker timed out");
}, 10000);
try {
  assert(await engine.render(job));
  const inspected = await engine.inspect(p[0], p[1]);
  assert.equal(
    inspected.nodes.find((node) => node.op === "analysis").source.modelID,
    low.id,
  );
} finally {
  clearTimeout(deadline);
  engine.cancel();
}
