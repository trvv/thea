/** Bounded, strict interpretations of actual source bytes, independent of rendering and DOM. */

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
    return {
      encoding: "UTF-8",
      codePoint: `U+${scalar.toString(16).toUpperCase().padStart(4, "0")}`,
      scalar,
      // Escaping keeps controls, line separators and invisible scalars unambiguous.
      character:
        scalar <= 0x1f ||
        (scalar >= 0x7f && scalar <= 0x9f) ||
        /\p{Default_Ignorable_Code_Point}|\p{Separator}/u.test(
          String.fromCodePoint(scalar),
        )
          ? scalar <= 0xffff
            ? `\\u${scalar.toString(16).toUpperCase().padStart(4, "0")}`
            : `\\u{${scalar.toString(16).toUpperCase()}}`
          : JSON.stringify(String.fromCodePoint(scalar)),
      sourceRange: {
        start: sourceStart + start,
        endExclusive: sourceStart + start + length,
      },
      bytes: [...bytes.subarray(start, start + length)],
      byteIndex: index - start,
      encodedLength: length,
    };
  }
  return null;
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
