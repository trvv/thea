import assert from "node:assert/strict";
import { selectRank } from "../select-rank.js";
let seed = 17;
for (const size of [1, 2, 3, 32, 4097, 100000]) {
  for (const mode of ["random", "constant", "ascending", "descending"]) {
    const values = Float64Array.from({ length: size }, (_, index) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return mode === "constant"
        ? 9
        : mode === "ascending"
          ? index
          : mode === "descending"
            ? size - index
            : (seed % 12347) / 255;
    });
    const sorted = values.slice().sort();
    for (const rank of [
      0,
      size >> 1,
      Math.max(0, Math.ceil(size * 0.99) - 1),
      size - 1,
    ])
      assert.equal(selectRank(values.slice(), rank), sorted[rank]);
  }
}
console.log(
  "Rank selection passes: exact endpoints/median/percentile, ties, ordered and random arrays.",
);
