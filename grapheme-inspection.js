/** Bounded UTF-8 grapheme previews, retaining scalar spans and explicit context limits. */
import { utf8At } from "./byte-interpretation.js";

let segmenter;

/** Segmentation is a preview when either end of the valid UTF-8 run lies beyond the supplied bytes. */
export function utf8GraphemeAt(
  bytes,
  index,
  sourceStart = 0,
  { leftBoundaryKnown = false, rightBoundaryKnown = false } = {},
) {
  if (bytes.length > 255)
    throw new RangeError("Grapheme preview accepts at most 255 context bytes");
  if (typeof Intl.Segmenter !== "function") return null;
  const origin = utf8At(bytes, index, sourceStart);
  if (!origin) return null;
  const scalars = [origin];
  while (scalars[0].sourceRange.start > sourceStart) {
    const end = scalars[0].sourceRange.start;
    const previous = utf8At(bytes, end - sourceStart - 1, sourceStart);
    if (!previous || previous.sourceRange.endExclusive !== end) {
      leftBoundaryKnown = true;
      break;
    }
    scalars.unshift(previous);
  }
  while (scalars.at(-1).sourceRange.endExclusive < sourceStart + bytes.length) {
    const start = scalars.at(-1).sourceRange.endExclusive;
    const next = utf8At(bytes, start - sourceStart, sourceStart);
    if (!next || next.sourceRange.start !== start) {
      rightBoundaryKnown = true;
      break;
    }
    scalars.push(next);
  }
  let utf16Offset = 0;
  const textOffsets = scalars.map((scalar) => {
    const start = utf16Offset;
    utf16Offset += scalar.scalar > 0xffff ? 2 : 1;
    return start;
  });
  const text = String.fromCodePoint(...scalars.map((value) => value.scalar));
  const target = textOffsets[scalars.indexOf(origin)];
  segmenter ||= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const segment of segmenter.segment(text)) {
    const end = segment.index + segment.segment.length;
    if (target < segment.index || target >= end) continue;
    const included = scalars.filter(
      (scalar, n) => textOffsets[n] >= segment.index && textOffsets[n] < end,
    );
    const start = included[0].sourceRange.start;
    const endExclusive = included.at(-1).sourceRange.endExclusive;
    return {
      kind: "grapheme preview",
      encoding: "UTF-8",
      // Keep invisible scalars escaped consistently with code-point inspection.
      character: `"${included.map((value) => (value.character.startsWith('"') ? value.character.slice(1, -1) : value.character)).join("")}"`,
      codePoints: included.map((value) => value.codePoint),
      sourceRange: { start, endExclusive },
      bytes: [
        ...bytes.subarray(start - sourceStart, endExclusive - sourceStart),
      ],
      byteIndex: sourceStart + index - start,
      contextRange: {
        start: sourceStart,
        endExclusive: sourceStart + bytes.length,
      },
      validRunRange: {
        start: scalars[0].sourceRange.start,
        endExclusive: scalars.at(-1).sourceRange.endExclusive,
      },
      contextClipped: { left: !leftBoundaryKnown, right: !rightBoundaryKnown },
      complete: leftBoundaryKnown && rightBoundaryKnown,
      scalars: included,
    };
  }
  return null;
}

/** Inspect at most 255 root bytes; never normalize or rewrite the source to form a cluster. */
export async function inspectUTF8Grapheme(
  source,
  sourceOffset,
  { radius = 64 } = {},
  current = () => true,
) {
  if (!current() || typeof Intl.Segmenter !== "function") return null;
  if (
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset >= source.size
  )
    return null;
  if (!Number.isInteger(radius) || radius < 3 || radius > 127)
    throw new RangeError("Grapheme context radius must be between 3 and 127");
  const start = Math.max(0, sourceOffset - radius);
  const end = Math.min(source.size, sourceOffset + radius + 1);
  const bytes = new Uint8Array(await source.slice(start, end).arrayBuffer());
  if (!current()) return null;
  if (bytes.length !== end - start)
    throw new Error("Byte source ended before its declared size.");
  return utf8GraphemeAt(bytes, sourceOffset - start, start, {
    leftBoundaryKnown: start === 0,
    rightBoundaryKnown: end === source.size,
  });
}
