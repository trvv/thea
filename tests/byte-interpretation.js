import assert from "node:assert/strict";
import { utf8At, inspectUtf8 } from "../byte-interpretation.js";

const encoder = new TextEncoder();
for (const scalar of [
  0, 0x1f, 0x20, 0x41, 0x7f, 0x80, 0xe9, 0x7ff, 0x800, 0x20ac, 0xd7ff, 0xe000,
  0xfeff, 0xfffd, 0xffff, 0x10000, 0x1f600, 0x10ffff,
]) {
  const bytes = encoder.encode(String.fromCodePoint(scalar));
  const neighborhood = Uint8Array.from([
    255,
    255,
    255,
    ...bytes,
    255,
    255,
    255,
  ]);
  for (let index = 0; index < bytes.length; index++) {
    const result = utf8At(neighborhood, index + 3, 100);
    assert.equal(result.scalar, scalar);
    assert.equal(result.encoding, "UTF-8");
    assert.equal(result.byteIndex, index);
    assert.equal(result.encodedLength, bytes.length);
    assert.deepEqual(result.bytes, [...bytes]);
    assert.deepEqual(result.sourceRange, {
      start: 103,
      endExclusive: 103 + bytes.length,
    });
    assert.equal(
      result.codePoint,
      `U+${scalar.toString(16).toUpperCase().padStart(4, "0")}`,
    );
  }
}

// Invalid input must never turn into a successful U+FFFD replacement decode.
for (const input of [
  [0x80],
  [0xbf],
  [0xc0, 0xaf],
  [0xc1, 0xbf],
  [0xc2],
  [0xe2, 0x82],
  [0xe0, 0x80, 0x80],
  [0xed, 0xa0, 0x80],
  [0xed, 0xbf, 0xbf],
  [0xf0, 0x80, 0x80, 0x80],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf5, 0x80, 0x80, 0x80],
  [0xfe],
  [0xff],
  [0xe2, 0x82, 0xc0],
]) {
  const bytes = Uint8Array.from(input);
  for (let index = 0; index < bytes.length; index++)
    assert.equal(utf8At(bytes, index), null, `Malformed ${input} at ${index}`);
}
assert.equal(utf8At(new Uint8Array(), 0), null);
for (const index of [-1, 0.5, NaN, Infinity, 1])
  assert.equal(utf8At(Uint8Array.of(65), index), null);
assert.equal(utf8At(Uint8Array.of(0), 0).character, "\\u0000");
assert.equal(utf8At(encoder.encode(" "), 0).character, "\\u0020");
assert.equal(utf8At(encoder.encode("\u200d"), 0).character, "\\u200D");
assert.equal(utf8At(encoder.encode("\u2028"), 0).character, "\\u2028");
assert.equal(utf8At(encoder.encode("é"), 0).character, '"é"');
assert.equal(utf8At(encoder.encode("e\u0301"), 0).scalar, 0x65);
assert.equal(utf8At(encoder.encode("e\u0301"), 1).scalar, 0x301);
assert.equal(utf8At(Uint8Array.of(0xc2, 0x41), 0), null);
assert.equal(utf8At(Uint8Array.of(0xc2, 0x41), 1).scalar, 65);

// Independent fatal decoder reference over deterministic random neighborhoods.
let state = 12345;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state >>> 24;
};
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
for (let n = 0; n < 4096; n++) {
  const bytes = Uint8Array.from({ length: 7 }, random);
  const index = n % bytes.length;
  let expected = null;
  for (let start = Math.max(0, index - 3); start <= index; start++) {
    for (let end = index + 1; end <= Math.min(bytes.length, start + 4); end++) {
      try {
        const decoded = [...decoder.decode(bytes.subarray(start, end))];
        if (decoded.length === 1)
          expected = {
            scalar: decoded[0].codePointAt(0),
            start,
            end,
          };
      } catch {}
    }
  }
  const result = utf8At(bytes, index);
  assert.equal(result?.scalar ?? null, expected?.scalar ?? null);
  if (result)
    assert.deepEqual(result.sourceRange, {
      start: expected.start,
      endExclusive: expected.end,
    });
}

const source = new Blob([encoder.encode("Aé€😀Z")]);
const reads = [];
const tracked = {
  size: source.size,
  slice(start, end) {
    reads.push([start, end]);
    return source.slice(start, end);
  },
};
for (let offset = 0; offset < source.size; offset++) {
  const result = await inspectUtf8(tracked, offset);
  assert(result);
  assert(
    result.sourceRange.start <= offset &&
      result.sourceRange.endExclusive > offset,
  );
}
assert(
  reads.every(
    ([start, end]) => start >= 0 && end <= source.size && end - start <= 7,
  ),
);
assert.equal((await inspectUtf8(tracked, 8)).scalar, 0x1f600);
for (const offset of [-1, 0.1, NaN, source.size])
  assert.equal(await inspectUtf8(tracked, offset), null);
const readCount = reads.length;
assert.equal(await inspectUtf8(tracked, 0, () => false), null);
assert.equal(reads.length, readCount);
let finish;
let current = true;
const pending = inspectUtf8(
  {
    size: 1,
    slice: () => ({
      arrayBuffer: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
  },
  0,
  () => current,
);
current = false;
finish(Uint8Array.of(65).buffer);
assert.equal(await pending, null);

console.log(
  "Byte interpretation checks pass: strict UTF-8, scalar boundaries, all clicked bytes, fatal-decoder reference, escaped controls, bounded root reads and stale replies.",
);
