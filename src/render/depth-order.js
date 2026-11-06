/** Stable exact ordering of Float32 depths, with source ordinal breaking ties. */
export function depthOrder(projected, order, scratch) {
  const count = order.length;
  const bits = new Uint32Array(
    projected.buffer,
    projected.byteOffset,
    projected.length,
  );
  if (!scratch.depthKeys || scratch.depthKeys.length < count) {
    scratch.depthKeys = new Uint32Array(count);
    scratch.depthTemporary = new Uint32Array(count);
    scratch.depthCounts = new Uint32Array(256);
  }
  const keys = scratch.depthKeys;
  let hasNaN = false;
  for (let i = 0; i < count; i++) {
    order[i] = i;
    const depth = projected[i * 4 + 2];
    hasNaN ||= Number.isNaN(depth);
    // Comparison sort treats signed zero as equal. NaN is outside valid projection.
    const word = depth === 0 ? 0 : bits[i * 4 + 2];
    keys[i] = word & 0x80000000 ? ~word : word ^ 0x80000000;
  }
  if (hasNaN) {
    order.sort((a, b) => projected[a * 4 + 2] - projected[b * 4 + 2]);
    return order;
  }
  let input = order;
  let output = scratch.depthTemporary;
  for (let shift = 0; shift < 32; shift += 8) {
    const counts = scratch.depthCounts;
    counts.fill(0);
    for (let i = 0; i < count; i++) counts[(keys[input[i]] >>> shift) & 255]++;
    let offset = 0;
    for (let bucket = 0; bucket < 256; bucket++) {
      const size = counts[bucket];
      counts[bucket] = offset;
      offset += size;
    }
    for (let i = 0; i < count; i++) {
      const index = input[i];
      output[counts[(keys[index] >>> shift) & 255]++] = index;
    }
    [input, output] = [output, input];
  }
  return order;
}
