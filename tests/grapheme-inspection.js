import assert from "node:assert/strict";
import { utf8GraphemeAt, inspectUTF8Grapheme } from "../grapheme-inspection.js";

const encoder = new TextEncoder();
for (const [text, start, end, codePoints] of [
  ["Ae\u0301B", 1, 4, ["U+0065", "U+0301"]],
  ["X👩‍🚀Y", 1, 12, ["U+1F469", "U+200D", "U+1F680"]],
  ["🇺🇸", 0, 8, ["U+1F1FA", "U+1F1F8"]],
  ["\r\n", 0, 2, ["U+000D", "U+000A"]],
]) {
  const bytes = encoder.encode(text);
  for (let index = start; index < end; index++) {
    const preview = utf8GraphemeAt(bytes, index, 100, {
      leftBoundaryKnown: true,
      rightBoundaryKnown: true,
    });
    assert.deepEqual(preview.sourceRange, {
      start: 100 + start,
      endExclusive: 100 + end,
    });
    assert.deepEqual(preview.codePoints, codePoints);
    assert.equal(preview.byteIndex, index - start);
    assert.equal(preview.complete, true);
    assert.deepEqual(preview.bytes, [...bytes.subarray(start, end)]);
    assert(
      preview.scalars.every(
        (scalar) =>
          scalar.sourceRange.start >= 100 + start &&
          scalar.sourceRange.endExclusive <= 100 + end,
      ),
    );
  }
}
const accented = await inspectUTF8Grapheme(
  new Blob([encoder.encode("e\u0301")]),
  2,
);
assert.equal(accented.complete, true);
assert.deepEqual(accented.codePoints, ["U+0065", "U+0301"]);
assert.notEqual(
  accented.character,
  '"é"',
  "Inspection must not normalize decomposed bytes",
);
const joined = utf8GraphemeAt(encoder.encode("👩‍🚀"), 5);
assert(
  joined.character.includes("\\u200D"),
  "Invisible joiner should be explicit",
);
assert.equal(joined.complete, false);
assert.deepEqual(joined.contextClipped, { left: true, right: true });
const invalidEdges = Uint8Array.from([255, ...encoder.encode("e\u0301"), 255]);
const local = utf8GraphemeAt(invalidEdges, 2, 31);
assert.equal(local.complete, true);
assert.deepEqual(local.validRunRange, { start: 32, endExclusive: 35 });
assert.equal(utf8GraphemeAt(invalidEdges, 0), null);
assert.equal(utf8GraphemeAt(new Uint8Array(), 0), null);
assert.throws(() => utf8GraphemeAt(new Uint8Array(256), 100), /255/);

const large = new Blob([encoder.encode("A".repeat(500))]);
const reads = [];
const tracked = {
  size: large.size,
  slice(start, end) {
    reads.push([start, end]);
    return large.slice(start, end);
  },
};
const clipped = await inspectUTF8Grapheme(tracked, 250, { radius: 127 });
assert.deepEqual(clipped.contextRange, { start: 123, endExclusive: 378 });
assert.deepEqual(clipped.contextClipped, { left: true, right: true });
assert.equal(clipped.complete, false);
assert(reads.every(([start, end]) => end - start <= 255));
await assert.rejects(
  inspectUTF8Grapheme(tracked, 250, { radius: 128 }),
  /radius/,
);
await assert.rejects(
  inspectUTF8Grapheme(tracked, 250, { radius: 2 }),
  /radius/,
);
assert.equal(await inspectUTF8Grapheme(tracked, -1), null);
const before = reads.length;
assert.equal(await inspectUTF8Grapheme(tracked, 1, {}, () => false), null);
assert.equal(reads.length, before);
let current = true;
assert.equal(
  await inspectUTF8Grapheme(
    {
      size: 1,
      slice: () => ({
        async arrayBuffer() {
          current = false;
          return Uint8Array.of(65).buffer;
        },
      }),
    },
    0,
    {},
    () => current,
  ),
  null,
);
const original = Intl.Segmenter;
try {
  Intl.Segmenter = undefined;
  assert.equal(utf8GraphemeAt(encoder.encode("A"), 0), null);
  assert.equal(await inspectUTF8Grapheme(tracked, 1), null);
  assert.equal(reads.length, before);
} finally {
  Intl.Segmenter = original;
}
console.log(
  "Grapheme preview checks pass: exact scalar/byte spans, combining/emoji/flags, no normalization, escaped joiners, bounded clipped context, cancellation and feature fallback.",
);
