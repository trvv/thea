/**
 * CantorDust-compatible 2D H traversal, expressed as affine descent rather than recursive
 * coordinate calls or an inverse cache. Orientation is locked by compatibility fixtures.
 * Source traversal: Battelle/cantordust 32aff417, resources/HCurve.java.
 */
export function hCurve(index, order, out, offset = 0) {
  if (!Number.isInteger(order) || order < 0 || order > 15)
    throw new RangeError("H-curve order must be 0–15");
  const side = 2 ** order;
  if (!Number.isSafeInteger(index) || index < 0 || index >= side * side)
    throw new RangeError("Invalid H-curve index");
  let n = side,
    x = 0,
    y = 0,
    sx = 1,
    sy = 1;
  for (let level = 0; level <= order; level++) {
    const triangle = (n * n) / 2;
    if (n > 1 && index >= triangle) {
      x += sx * (n - 1);
      y += sy * (n - 1);
      sx = -sx;
      sy = -sy;
      index -= triangle;
    }
    if (index < 2) {
      y += sy * index;
      break;
    }
    const part = Math.floor((4 * index) / triangle);
    if (part === 1) {
      index = triangle / 2 - 1 - index;
      y += sy * (n - 1);
      sy = -sy;
    } else if (part === 2) {
      index = (3 * triangle) / 4 - 1 - index;
      x += sx * (n / 2 - 1);
      sx = -sx;
      y += (sy * n) / 2;
    } else if (part === 3) {
      index -= (3 * triangle) / 4;
      x += (sx * n) / 2;
      y += (sy * n) / 2;
    }
    n /= 2;
  }
  out[offset] = (x + 0.5) / side;
  out[offset + 1] = (y + 0.5) / side;
  return out;
}
