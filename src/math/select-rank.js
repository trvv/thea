/** In-place nearest-rank selection, with a bounded partition count and native-sort fallback. */
export function selectRank(values, rank) {
  let left = 0,
    right = values.length - 1;
  for (let iteration = 0; left < right; iteration++) {
    if (iteration === 64) {
      values.subarray(left, right + 1).sort();
      return values[rank];
    }
    const middle = (left + right) >>> 1;
    const a = values[left],
      b = values[middle],
      c = values[right];
    const pivot = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    let low = left,
      index = left,
      high = right;
    while (index <= high) {
      const value = values[index];
      if (value < pivot) {
        values[index++] = values[low];
        values[low++] = value;
      } else if (value > pivot) {
        values[index] = values[high];
        values[high--] = value;
      } else index++;
    }
    if (rank < low) right = low - 1;
    else if (rank > high) left = high + 1;
    else return values[rank];
  }
  return values[rank];
}
