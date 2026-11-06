/** Explicit selection-scoped encoding lookups; local plausibility is not file classification. */
import { utf8At, utf16At, utf32At } from "./byte-interpretation.js";

export function encodingCandidate(bytes, index, parameters) {
  if (parameters.encoding === "utf8") return utf8At(bytes, index);
  const width = parameters.encoding.startsWith("utf16") ? 2 : 4;
  const decode = width === 2 ? utf16At : utf32At;
  return (
    decode(bytes, index, 0, parameters.encoding.endsWith("le")).find(
      (candidate) =>
        (candidate.sourceRange.start - parameters.origin) % width === 0,
    ) || null
  );
}

export function encodingResult(bytes, index, parameters) {
  const candidate = encodingCandidate(bytes, index, parameters);
  return candidate
    ? [
        candidate.scalar / 0x10ffff,
        candidate.encodedLength,
        candidate.byteIndex,
        1,
      ]
    : [0, 0, 0, 0];
}
