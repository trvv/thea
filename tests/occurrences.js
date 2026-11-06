import assert from "node:assert/strict";
import { findOccurrences, inspectByteContext } from "../occurrences.js";
import { scanChunkSize } from "../scan.js";

const data = Uint8Array.from([9, 1, 2, 1, 2, 1, 2, 8, 1, 2, 1]);
const source = new Blob([data]);
const starts = (result) => result.matches.map((match) => match.start);
assert.deepEqual(
  starts(await findOccurrences(source, { pattern: [1, 2] })),
  [1, 3, 5, 8],
);
assert.deepEqual(
  starts(
    await findOccurrences(source, { pattern: [1, 2], direction: "previous" }),
  ),
  [8, 5, 3, 1],
);
assert.deepEqual(
  starts(
    await findOccurrences(source, { pattern: [1, 2, 1], start: 2, end: 10 }),
  ),
  [3],
);
assert.deepEqual(
  starts(await findOccurrences(source, { pattern: [1, 2], after: 3 })),
  [5, 8],
);
assert.deepEqual(
  starts(
    await findOccurrences(source, {
      pattern: [1, 2],
      after: 5,
      direction: "previous",
    }),
  ),
  [3, 1],
);
const wrapped = await findOccurrences(source, {
  pattern: [1, 2],
  after: 5,
  wrap: true,
});
assert.deepEqual(starts(wrapped), [8, 1, 3, 5]);
assert.equal(wrapped.wrapped, true);
assert.equal(wrapped.exhausted, true);
assert.equal(wrapped.hasMore, false);
assert.deepEqual(
  starts(
    await findOccurrences(source, {
      pattern: [1, 2],
      after: 3,
      direction: "previous",
      wrap: true,
    }),
  ),
  [1, 8, 5, 3],
);
const page = await findOccurrences(source, { pattern: [1, 2], limit: 2 });
assert.deepEqual(starts(page), [1, 3]);
assert.equal(page.nextCursor, 3);
assert.equal(page.exhausted, false);
assert.equal(page.hasMore, null);
assert.deepEqual(
  starts(
    await findOccurrences(source, {
      pattern: [1, 2],
      after: page.nextCursor,
      limit: 2,
    }),
  ),
  [5, 8],
);
assert.deepEqual(
  starts(
    await findOccurrences(new Blob([Uint8Array.of(1, 1, 1, 1)]), {
      pattern: [1, 1],
    }),
  ),
  [0, 1, 2],
);
assert.deepEqual(
  starts(
    await findOccurrences(source, { pattern: [1, 2], after: 999, wrap: true }),
  ),
  [1, 3, 5, 8],
);
assert.deepEqual(
  starts(
    await findOccurrences(source, {
      pattern: [1, 2],
      after: -999,
      direction: "previous",
      wrap: true,
    }),
  ),
  [8, 5, 3, 1],
);
for (const options of [
  { pattern: [] },
  { pattern: [256] },
  { pattern: [1.5] },
  { pattern: [1], limit: 0 },
  { pattern: [1], direction: "up" },
  { pattern: [1], wrap: 1 },
  { pattern: [1], start: -1 },
  { pattern: [1], end: 99 },
])
  await assert.rejects(findOccurrences(source, options));
assert.deepEqual(
  starts(await findOccurrences(new Blob(), { pattern: [1] })),
  [],
);
assert.deepEqual(
  starts(
    await findOccurrences(source, { pattern: [1, 2, 3], start: 2, end: 3 }),
  ),
  [],
);

const largeData = new Uint8Array(scanChunkSize * 3 + 1).fill(7);
for (const offset of [
  3,
  scanChunkSize - 1,
  scanChunkSize * 2,
  largeData.length - 3,
])
  largeData.set([1, 2, 3], offset);
const largeBlob = new Blob([largeData]);
const reads = [];
const tracked = {
  size: largeBlob.size,
  slice(start, end) {
    reads.push([start, end]);
    return largeBlob.slice(start, end);
  },
};
const forward = await findOccurrences(tracked, { pattern: [1, 2, 3] });
assert.deepEqual(starts(forward), [
  3,
  scanChunkSize - 1,
  scanChunkSize * 2,
  largeData.length - 3,
]);
assert(
  reads.every(
    ([start, end]) =>
      end - start <= scanChunkSize + 2 && start >= 0 && end <= largeBlob.size,
  ),
);
const backward = await findOccurrences(tracked, {
  pattern: [1, 2, 3],
  direction: "previous",
});
assert.deepEqual(starts(backward), [...starts(forward)].reverse());
reads.length = 0;
const next = await findOccurrences(tracked, { pattern: [1, 2, 3], limit: 1 });
assert.deepEqual(starts(next), [3]);
assert.equal(
  reads.length,
  1,
  "Next should not scan ahead merely to count further matches",
);
const early = reads.length;
assert.equal(
  await findOccurrences(tracked, { pattern: [1] }, () => false),
  null,
);
assert.equal(reads.length, early);
let checks = 0;
assert.equal(
  await findOccurrences(tracked, { pattern: [255] }, () => ++checks < 4),
  null,
);
const stale = {
  size: 4,
  slice: () => ({
    async arrayBuffer() {
      checks = 99;
      return Uint8Array.of(1, 2, 3, 4).buffer;
    },
  }),
};
checks = 0;
assert.equal(
  await findOccurrences(stale, { pattern: [1] }, () => checks < 10),
  null,
);

// Tiny independent reference over deterministic pseudo-random scopes/cursors in both directions.
let state = 42;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
};
for (let test = 0; test < 128; test++) {
  const bytes = Uint8Array.from({ length: 31 }, () => random() % 5);
  const start = random() % 10;
  const end = start + (random() % (bytes.length - start + 1));
  const width = (random() % 3) + 1;
  const pattern = Array.from({ length: width }, () => random() % 5);
  const after = (random() % 40) - 4;
  const all = [];
  for (let offset = start; offset + width <= end; offset++)
    if (pattern.every((byte, i) => bytes[offset + i] === byte))
      all.push(offset);
  for (const direction of ["next", "previous"]) {
    const order = direction === "next" ? all : [...all].reverse();
    const primary = order.filter((offset) =>
      direction === "next" ? offset > after : offset < after,
    );
    const remainder = order.filter((offset) =>
      direction === "next" ? offset <= after : offset >= after,
    );
    for (const wrap of [false, true]) {
      const expected = wrap ? [...primary, ...remainder] : primary;
      const result = await findOccurrences(new Blob([bytes]), {
        start,
        end,
        pattern,
        after,
        direction,
        wrap,
      });
      assert.deepEqual(starts(result), expected);
    }
  }
}

const context = await inspectByteContext(source, 3, { radius: 2 });
assert.deepEqual(context, {
  sourceOffset: 3,
  sourceRange: { start: 1, endExclusive: 6 },
  byteIndex: 2,
  bytes: [1, 2, 1, 2, 1],
});
assert.deepEqual((await inspectByteContext(source, 0)).sourceRange, {
  start: 0,
  endExclusive: data.length,
});
assert.deepEqual(
  (await inspectByteContext(source, data.length - 1, { radius: 0 })).bytes,
  [1],
);
assert.equal(
  (await inspectByteContext(tracked, scanChunkSize, { radius: 127 })).bytes
    .length,
  255,
);
await assert.rejects(inspectByteContext(source, 0, { radius: 128 }));
await assert.rejects(inspectByteContext(source, source.size));
assert.equal(await inspectByteContext(source, 0, {}, () => false), null);
checks = 0;
assert.equal(await inspectByteContext(stale, 0, {}, () => checks < 10), null);
const truncated = { size: 16, slice: () => new Blob([Uint8Array.of(1)]) };
await assert.rejects(
  findOccurrences(truncated, { pattern: [1] }),
  /ended before/,
);
await assert.rejects(inspectByteContext(truncated, 3), /ended before/);

console.log(
  "Occurrence checks pass: exact overlapping/pages, forward/reverse/wrap/cursors, early limited reads, cancellation, direct reference, clipped context and validation.",
);
