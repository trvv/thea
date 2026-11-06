/** Exact previous four-byte blocks, with explicitly bounded history and chosen-candidate extension. */
import { mapEntryEstimate, scanChunkSize, yieldScan } from "./scan.js";

const keyAt = (bytes, index) =>
  bytes[index] * 16777216 +
  bytes[index + 1] * 65536 +
  bytes[index + 2] * 256 +
  bytes[index + 3];

/** Returns only requested results; scans required history once without a whole-selection result array. */
export async function prepareRepetition(
  bytes,
  parameters,
  indices,
  current = () => true,
  checkBudget = () => {},
) {
  if (!current()) return null;
  const results = new Map();
  if (!indices.length) return results;
  checkBudget(indices.length * mapEntryEstimate, "Repetition requests");
  const requested = new Set(indices);
  const latest = new Map();
  const end = Math.min(bytes.length - 1, indices[indices.length - 1]);
  let reportedSize = 0;
  let extensionWork = 0;
  for (
    let chunk = Math.max(0, indices[0] - parameters.history);
    chunk <= end;
    chunk += scanChunkSize
  ) {
    const limit = Math.min(end + 1, chunk + scanChunkSize);
    for (let index = chunk; index < limit; index++) {
      const expired = index - parameters.history - 1;
      if (expired >= 0 && expired + 4 <= bytes.length) {
        const key = keyAt(bytes, expired);
        if (latest.get(key) === expired) latest.delete(key);
      }
      const eligible = index - (parameters.overlap ? 1 : 4);
      if (
        eligible >= Math.max(0, index - parameters.history) &&
        eligible + 4 <= bytes.length
      ) {
        latest.set(keyAt(bytes, eligible), eligible);
      }
      if (latest.size > reportedSize) {
        checkBudget(
          (latest.size + requested.size + results.size) * mapEntryEstimate +
            results.size * 32,
          "Repetition history",
        );
        reportedSize = latest.size;
      }
      if (!requested.has(index)) continue;
      const previous =
        index + 4 <= bytes.length ? latest.get(keyAt(bytes, index)) : undefined;
      let length = previous === undefined ? 0 : 4;
      const maximum =
        previous === undefined
          ? 0
          : Math.min(
              parameters.maxLength,
              parameters.overlap ? parameters.maxLength : index - previous,
            );
      while (
        previous !== undefined &&
        length < maximum &&
        index + length < bytes.length &&
        bytes[previous + length] === bytes[index + length]
      )
        length++;
      extensionWork += length;
      results.set(index, [
        previous ?? -1,
        previous === undefined ? 0 : index - previous,
        length,
        previous === undefined ? 0 : 1,
      ]);
      checkBudget(
        (latest.size + requested.size + results.size) * mapEntryEstimate +
          results.size * 32,
        "Repetition results",
      );
      if (extensionWork >= scanChunkSize) {
        if (!(await yieldScan(current))) return null;
        extensionWork = 0;
      }
    }
    if (limit <= end && !(await yieldScan(current))) return null;
  }
  return current() ? results : null;
}
