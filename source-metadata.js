/** Optional file-offset mappings and annotations. Never infer an executable address from a view. */
export function validateSourceMetadata(value, size) {
  if (!value || !Number.isSafeInteger(size) || size < 0)
    throw new TypeError("Invalid source metadata");
  const bounded = (items) => {
    if (!Array.isArray(items) || items.length > 10000)
      throw new TypeError("Expected at most 10000 source spans");
    return items;
  };
  const span = (entry) => {
    if (
      !Number.isSafeInteger(entry.start) ||
      !Number.isSafeInteger(entry.endExclusive) ||
      entry.start < 0 ||
      entry.endExclusive <= entry.start ||
      entry.endExclusive > size
    )
      throw new TypeError("Metadata span lies outside the source");
    return { start: entry.start, endExclusive: entry.endExclusive };
  };
  const text = (value = "") => {
    if (typeof value !== "string" || value.length > 1024)
      throw new TypeError("Invalid source label");
    return value;
  };
  return {
    segments: bounded(value.segments ?? []).map((entry) => {
      if (
        typeof entry.address !== "string" ||
        !/^(?:0x[0-9a-fA-F]{1,32}|[0-9]{1,39})$/.test(entry.address)
      )
        throw new TypeError("Address must be an unsigned integer string");
      return {
        ...span(entry),
        address: `0x${BigInt(entry.address).toString(16).toUpperCase()}`,
        addressSpace: text(entry.addressSpace),
        label: text(entry.label),
      };
    }),
    annotations: bounded(value.annotations ?? []).map((entry) => ({
      ...span(entry),
      label: text(entry.label),
      kind: text(entry.kind),
    })),
  };
}

export function describeSourceOffset(metadata, offset) {
  if (!metadata) return undefined;
  return {
    sourceOffset: offset,
    addresses: Object.fromEntries(
      metadata.segments
        .filter((entry) => offset >= entry.start && offset < entry.endExclusive)
        .map((entry, index) => [
          `Mapping ${index + 1}`,
          {
            ...entry,
            address: `0x${(BigInt(entry.address) + BigInt(offset - entry.start)).toString(16).toUpperCase()}`,
          },
        ]),
    ),
    annotations: Object.fromEntries(
      metadata.annotations
        .filter((entry) => offset >= entry.start && offset < entry.endExclusive)
        .map((entry, index) => [`Annotation ${index + 1}`, entry]),
    ),
  };
}
