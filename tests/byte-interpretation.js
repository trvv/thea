import assert from "node:assert/strict";
import {
  utf8At,
  utf16At,
  utf32At,
  inspectUtf8,
  inspectEncodings,
} from "../src/analysis/byte-interpretation.js";

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

// Every byte of a valid code unit/surrogate pair resolves the original scalar in both byte orders.
for (const littleEndian of [true, false]) {
  for (const scalar of [
    0, 0x41, 0xe9, 0x20ac, 0xd7ff, 0xe000, 0xfeff, 0xfffd, 0xffff, 0x10000,
    0x1f600, 0x10ffff,
  ]) {
    const text = String.fromCodePoint(scalar);
    const encoded16 = new Uint8Array(text.length * 2);
    const data16 = new DataView(encoded16.buffer);
    for (let n = 0; n < text.length; n++)
      data16.setUint16(n * 2, text.charCodeAt(n), littleEndian);
    const encoded32 = new Uint8Array(4);
    new DataView(encoded32.buffer).setUint32(0, scalar, littleEndian);
    for (const [bytes, decode, unit] of [
      [encoded16, utf16At, 2],
      [encoded32, utf32At, 4],
    ]) {
      const padded = Uint8Array.from([255, 255, 255, ...bytes, 255, 255, 255]);
      for (let byte = 0; byte < bytes.length; byte++) {
        const candidates = decode(padded, 3 + byte, 100, littleEndian);
        const candidate = candidates.find(
          (value) => value.sourceRange.start === 103,
        );
        assert(
          candidate,
          `Missing UTF-${unit * 8} candidate for ${scalar} byte ${byte}`,
        );
        assert.equal(candidate.scalar, scalar);
        assert.equal(candidate.encodedLength, bytes.length);
        assert.equal(candidate.byteIndex, byte);
        assert.equal(candidate.alignment, 103 % unit);
        assert.equal(candidate.alignmentOrigin, 0);
        assert.equal(candidate.byteOrder, littleEndian ? "little" : "big");
        assert.deepEqual(candidate.bytes, [...bytes]);
      }
    }
  }
  for (const scalar of [0xd800, 0xdfff, 0x110000, 0xffffffff]) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, scalar, littleEndian);
    for (let index = 0; index < 4; index++)
      assert(
        !utf32At(bytes, index, 0, littleEndian).some(
          (value) => value.sourceRange.start === 0,
        ),
      );
  }
  for (const unit of [0xd800, 0xdbff, 0xdc00, 0xdfff]) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, unit, littleEndian);
    assert.deepEqual(utf16At(bytes, 0, 0, littleEndian), []);
  }
}
assert.deepEqual(utf16At(new Uint8Array(), 0), []);
assert.deepEqual(utf32At(Uint8Array.of(0, 0, 0), 1), []);
assert.throws(() => utf16At(Uint8Array.of(0, 0), 0, 0, "little"), /Byte order/);
assert.throws(() => utf32At(new Uint8Array(4), 0, 0, 1), /Byte order/);
const unalignedStorage = Uint8Array.of(255, 0x3d, 0xd8, 0, 0xde, 255);
assert(
  utf16At(unalignedStorage.subarray(1, 5), 3).some(
    (value) => value.scalar === 0x1f600,
  ),
);

// Fatal native UTF-16 decoders independently verify every locally viable candidate.
for (const littleEndian of [true, false]) {
  const native = new TextDecoder(littleEndian ? "utf-16le" : "utf-16be", {
    fatal: true,
    ignoreBOM: true,
  });
  for (let n = 0; n < 2048; n++) {
    const bytes = Uint8Array.from({ length: 7 }, random);
    const index = n % bytes.length;
    const expected = [];
    for (let start = Math.max(0, index - 3); start <= index; start++) {
      for (const length of [2, 4]) {
        if (start + length > bytes.length || index >= start + length) continue;
        try {
          const decoded = [
            ...native.decode(bytes.subarray(start, start + length)),
          ];
          if (decoded.length === 1)
            expected.push([start, start + length, decoded[0].codePointAt(0)]);
        } catch {}
      }
    }
    const actual = utf16At(bytes, index, 0, littleEndian).map((value) => [
      value.sourceRange.start,
      value.sourceRange.endExclusive,
      value.scalar,
    ]);
    assert.deepEqual(actual, expected);
  }
}
const combinedReads = [];
const utf16Source = new Blob([Uint8Array.of(0xff, 0x3d, 0xd8, 0, 0xde, 0xff)]);
const combinedSource = {
  size: utf16Source.size,
  slice(start, end) {
    combinedReads.push([start, end]);
    return utf16Source.slice(start, end);
  },
};
for (const offset of [1, 2, 3, 4]) {
  const candidates = await inspectEncodings(combinedSource, offset);
  const match = candidates.find(
    (value) => value.encoding === "UTF-16LE" && value.scalar === 0x1f600,
  );
  assert(match);
  assert.equal(match.byteIndex, offset - 1);
  assert.equal(match.alignment, 1);
  assert(candidates.length <= 13);
}
assert.equal(
  combinedReads.length,
  4,
  "Encoding candidates should share one read per inspection",
);
assert(
  combinedReads.every(
    ([start, end]) => start >= 0 && end <= utf16Source.size && end - start <= 7,
  ),
);
assert.equal(await inspectEncodings(combinedSource, 0, () => false), null);
assert.equal(await inspectEncodings(combinedSource, -1), null);
let encodingCurrent = true;
const encodingPending = inspectEncodings(
  {
    size: 4,
    slice: () => ({
      async arrayBuffer() {
        encodingCurrent = false;
        return new ArrayBuffer(4);
      },
    }),
  },
  1,
  () => encodingCurrent,
);
assert.equal(await encodingPending, null);
await assert.rejects(
  inspectEncodings({ size: 10, slice: () => new Blob([Uint8Array.of(0)]) }, 4),
  /ended before/,
);

console.log(
  "Byte interpretation checks pass: strict UTF-8/16/32, both endian/alignment candidates, all clicked bytes, fatal-decoder references, escaped controls, bounded shared root reads and stale replies.",
);
