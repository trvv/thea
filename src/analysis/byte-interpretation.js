/** Bounded, strict interpretations of actual source bytes, independent of rendering and DOM. */

function scalarInterpretation(
  bytes,
  start,
  length,
  scalar,
  index,
  sourceStart,
  encoding,
) {
  const character = String.fromCodePoint(scalar);
  const escaped =
    scalar <= 0x1f ||
    (scalar >= 0x7f && scalar <= 0x9f) ||
    /\p{Default_Ignorable_Code_Point}|\p{Separator}/u.test(character);
  return {
    encoding,
    codePoint: `U+${scalar.toString(16).toUpperCase().padStart(4, "0")}`,
    scalar,
    character: escaped
      ? scalar <= 0xffff
        ? `\\u${scalar.toString(16).toUpperCase().padStart(4, "0")}`
        : `\\u{${scalar.toString(16).toUpperCase()}}`
      : JSON.stringify(character),
    sourceRange: {
      start: sourceStart + start,
      endExclusive: sourceStart + start + length,
    },
    bytes: [...bytes.subarray(start, start + length)],
    byteIndex: index - start,
    encodedLength: length,
  };
}

/**
 * Find a well-formed UTF-8 scalar containing an index into a byte neighborhood.
 * No replacement decoding: malformed or incomplete sequences have no interpretation.
 */
export function utf8At(bytes, index, sourceStart = 0) {
  if (!Number.isInteger(index) || index < 0 || index >= bytes.length)
    return null;
  for (let start = Math.max(0, index - 3); start <= index; start++) {
    const lead = bytes[start];
    const length =
      lead <= 0x7f
        ? 1
        : lead >= 0xc2 && lead <= 0xdf
          ? 2
          : lead >= 0xe0 && lead <= 0xef
            ? 3
            : lead >= 0xf0 && lead <= 0xf4
              ? 4
              : 0;
    if (!length || index >= start + length || start + length > bytes.length)
      continue;
    let scalar = lead & (length === 1 ? 0x7f : (1 << (7 - length)) - 1);
    let valid = true;
    for (let i = 1; i < length; i++) {
      const next = bytes[start + i];
      if (next < 0x80 || next > 0xbf) {
        valid = false;
        break;
      }
      scalar = scalar * 64 + (next & 0x3f);
    }
    if (
      !valid ||
      scalar < [0, 0, 0x80, 0x800, 0x10000][length] ||
      (scalar >= 0xd800 && scalar <= 0xdfff) ||
      scalar > 0x10ffff
    )
      continue;
    return scalarInterpretation(
      bytes,
      start,
      length,
      scalar,
      index,
      sourceStart,
      "UTF-8",
    );
  }
  return null;
}

/** All locally well-formed UTF-16 scalars containing the byte, with both possible alignments. */
export function utf16At(bytes, index, sourceStart = 0, littleEndian = true) {
  if (typeof littleEndian !== "boolean")
    throw new TypeError("Byte order must be boolean");
  if (!Number.isInteger(index) || index < 0 || index >= bytes.length) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const candidates = [];
  for (
    let start = Math.max(0, index - 3);
    start <= index && start + 2 <= bytes.length;
    start++
  ) {
    const unit = view.getUint16(start, littleEndian);
    let scalar = unit;
    let length = 2;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (start + 4 > bytes.length) continue;
      const low = view.getUint16(start + 2, littleEndian);
      if (low < 0xdc00 || low > 0xdfff) continue;
      scalar = 0x10000 + (unit - 0xd800) * 0x400 + low - 0xdc00;
      length = 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) continue;
    if (index >= start + length) continue;
    candidates.push({
      ...scalarInterpretation(
        bytes,
        start,
        length,
        scalar,
        index,
        sourceStart,
        littleEndian ? "UTF-16LE" : "UTF-16BE",
      ),
      byteOrder: littleEndian ? "little" : "big",
      codeUnitBytes: 2,
      alignmentOrigin: 0,
      alignment: (sourceStart + start) % 2,
    });
  }
  return candidates;
}

/** All locally well-formed UTF-32 scalars containing the byte, with all four possible alignments. */
export function utf32At(bytes, index, sourceStart = 0, littleEndian = true) {
  if (typeof littleEndian !== "boolean")
    throw new TypeError("Byte order must be boolean");
  if (!Number.isInteger(index) || index < 0 || index >= bytes.length) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const candidates = [];
  for (
    let start = Math.max(0, index - 3);
    start <= index && start + 4 <= bytes.length;
    start++
  ) {
    const scalar = view.getUint32(start, littleEndian);
    if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) continue;
    candidates.push({
      ...scalarInterpretation(
        bytes,
        start,
        4,
        scalar,
        index,
        sourceStart,
        littleEndian ? "UTF-32LE" : "UTF-32BE",
      ),
      byteOrder: littleEndian ? "little" : "big",
      codeUnitBytes: 4,
      alignmentOrigin: 0,
      alignment: (sourceStart + start) % 4,
    });
  }
  return candidates;
}

/** Inspect UTF-8, UTF-16LE/BE and UTF-32LE/BE in one clipped seven-byte root-source read. */
export async function inspectEncodings(
  source,
  sourceOffset,
  current = () => true,
) {
  if (
    !current() ||
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset >= source.size
  )
    return null;
  const start = Math.max(0, sourceOffset - 3);
  const end = Math.min(source.size, sourceOffset + 4);
  const bytes = new Uint8Array(await source.slice(start, end).arrayBuffer());
  if (!current()) return null;
  if (bytes.length !== end - start)
    throw new Error("Byte source ended before its declared size.");
  const index = sourceOffset - start;
  const utf8 = utf8At(bytes, index, start);
  return [
    ...(utf8 ? [utf8] : []),
    ...utf16At(bytes, index, start, true),
    ...utf16At(bytes, index, start, false),
    ...utf32At(bytes, index, start, true),
    ...utf32At(bytes, index, start, false),
  ];
}

/** Inspect at most seven root-source bytes; a selected interval never truncates a scalar. */
export async function inspectUtf8(source, sourceOffset, current = () => true) {
  if (
    !current() ||
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset >= source.size
  )
    return null;
  const start = Math.max(0, sourceOffset - 3);
  const end = Math.min(source.size, sourceOffset + 4);
  const bytes = new Uint8Array(await source.slice(start, end).arrayBuffer());
  if (!current()) return null;
  return utf8At(bytes, sourceOffset - start, start);
}
