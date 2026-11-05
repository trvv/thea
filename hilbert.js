/**
 * Three-dimensional Hilbert index -> normalized cell center.
 * Uses Skilling's transpose/Gray-decode construction (Programming the Hilbert
 * curve, doi:10.1063/1.1751381). Axis orientation is fixed by the order-1 fixture.
 * Ten bits per axis keep the entire curve index within signed 32-bit shader
 * arithmetic. Compute only requested coordinates, never a side^3 lookup table.
 */
export const hilbert3DMaxOrder = 10;

export function hilbert3D(index, order, out, offset = 0) {
 if (!Number.isInteger(order) || order < 0 || order > hilbert3DMaxOrder) throw new RangeError('Invalid 3D Hilbert order');
 const side = 2 ** order;
 if (!Number.isSafeInteger(index) || index < 0 || index >= side ** 3) throw new RangeError('Invalid 3D Hilbert index');
 out[offset] = out[offset + 1] = out[offset + 2] = 0;
 // Deinterleave the distance into its three transposed coordinate words.
 for (let bit = 0; bit < order; bit++) for (let axis = 0; axis < 3; axis++) {
  out[offset + axis] |= ((index >>> (bit * 3 + 2 - axis)) & 1) << bit;
 }
 // Decode the Gray code, then undo the coordinate exchanges/reflections.
 const tail = out[offset + 2] >>> 1;
 out[offset + 2] ^= out[offset + 1];
 out[offset + 1] ^= out[offset];
 out[offset] ^= tail;
 for (let scale = 2; scale < side; scale *= 2) {
  const mask = scale - 1;
  for (let axis = 2; axis >= 0; axis--) {
   if (out[offset + axis] & scale) out[offset] ^= mask;
   else {
    const exchange = (out[offset] ^ out[offset + axis]) & mask;
    out[offset] ^= exchange;
    out[offset + axis] ^= exchange;
   }
  }
 }
 for (let axis = 0; axis < 3; axis++) out[offset + axis] = (out[offset + axis] + 0.5) / side;
 return out;
}
