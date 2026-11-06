/** Bounded on-demand pattern navigation and root-source context; no whole-source occurrence index. */
import { readProviderBytes } from "../data/provider-diagnostics.js";
import { scanChunkSize, yieldScan } from "../data/scan.js";

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(
      `${name} must be an integer from ${minimum} to ${maximum}`,
    );
  return value;
}

/**
 * Search complete patterns inside an absolute half-open source scope, after an exclusive cursor.
 * A limited result stops at the requested match rather than scanning ahead to count more matches.
 */
export async function findOccurrences(
  source,
  options,
  current = () => true,
  diagnostics,
) {
  if (!current()) return null;
  const start = integer(options.start ?? 0, 0, source.size, "Scope start");
  const end = integer(
    options.end ?? source.size,
    start,
    source.size,
    "Scope end",
  );
  const pattern = Array.from(options.pattern || []);
  integer(pattern.length, 1, 32, "Pattern length");
  for (const value of pattern) integer(value, 0, 255, "Pattern byte");
  const limit = integer(options.limit ?? 64, 1, 256, "Match limit");
  const direction = options.direction ?? "next";
  if (!["next", "previous"].includes(direction))
    throw new TypeError("Unknown occurrence direction");
  const wrap = options.wrap ?? false;
  if (typeof wrap !== "boolean") throw new TypeError("Wrap must be boolean");
  const lastExclusive = Math.max(start, end - pattern.length + 1);
  const after = integer(
    options.after ?? (direction === "next" ? start - 1 : lastExclusive),
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    "Occurrence cursor",
  );
  const split =
    direction === "next"
      ? after < start
        ? start
        : after >= lastExclusive - 1
          ? lastExclusive
          : after + 1
      : Math.max(start, Math.min(lastExclusive, after));
  const ranges =
    direction === "next"
      ? [
          { start: split, end: lastExclusive, wrapped: false },
          ...(wrap ? [{ start, end: split, wrapped: true }] : []),
        ]
      : [
          { start, end: split, wrapped: false },
          ...(wrap
            ? [{ start: split, end: lastExclusive, wrapped: true }]
            : []),
        ];
  const matches = [];
  let wrapped = false;
  const result = (exhausted) => ({
    pattern,
    scope: { start, endExclusive: end },
    direction,
    matches,
    nextCursor: matches.at(-1)?.start ?? after,
    wrapped,
    exhausted,
    // More matching results are unknown when unsearched candidates remain.
    hasMore: exhausted ? false : null,
  });
  for (let r = 0; r < ranges.length; r++) {
    const range = ranges[r];
    let position = direction === "next" ? range.start : range.end;
    while (
      direction === "next" ? position < range.end : position > range.start
    ) {
      const low =
        direction === "next"
          ? position
          : Math.max(range.start, position - scanChunkSize);
      const high =
        direction === "next"
          ? Math.min(range.end, position + scanChunkSize)
          : position;
      const bytes = await readProviderBytes(
        source,
        low,
        high + pattern.length - 1,
        diagnostics,
      );
      if (!current()) return null;
      if (bytes.length !== high - low + pattern.length - 1)
        throw new Error("Byte source ended before its declared size.");
      for (
        let address = direction === "next" ? low : high - 1;
        direction === "next" ? address < high : address >= low;
        address += direction === "next" ? 1 : -1
      ) {
        const index = address - low;
        if (bytes[index] !== pattern[0]) continue;
        let matched = true;
        for (let n = 1; n < pattern.length; n++) {
          if (bytes[index + n] !== pattern[n]) {
            matched = false;
            break;
          }
        }
        if (!matched) continue;
        matches.push({
          start: address,
          endExclusive: address + pattern.length,
        });
        wrapped ||= range.wrapped;
        if (matches.length === limit) {
          const remaining =
            (direction === "next"
              ? address + 1 < range.end
              : address > range.start) ||
            ranges.slice(r + 1).some((next) => next.start < next.end);
          return result(!remaining);
        }
      }
      position = direction === "next" ? high : low;
      const remaining =
        (direction === "next"
          ? position < range.end
          : position > range.start) ||
        ranges.slice(r + 1).some((next) => next.start < next.end);
      if (remaining && !(await yieldScan(current))) return null;
    }
  }
  return current() ? result(true) : null;
}

/** Read at most 255 actual root-source bytes around an addressed byte. */
export async function inspectByteContext(
  source,
  sourceOffset,
  { radius = 16 } = {},
  current = () => true,
) {
  if (!current()) return null;
  integer(sourceOffset, 0, source.size - 1, "Source offset");
  integer(radius, 0, 127, "Context radius");
  const start = Math.max(0, sourceOffset - radius);
  const end = Math.min(source.size, sourceOffset + radius + 1);
  const bytes = await readProviderBytes(source, start, end);
  if (!current()) return null;
  if (bytes.length !== end - start)
    throw new Error("Byte source ended before its declared size.");
  return {
    sourceOffset,
    sourceRange: { start, endExclusive: end },
    byteIndex: sourceOffset - start,
    bytes: [...bytes],
  };
}
