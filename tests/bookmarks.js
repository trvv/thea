import assert from "node:assert/strict";
import {
  sourceIdentity,
  readBookmarks,
  saveBookmark,
  deleteBookmark,
  storageKey,
} from "../src/presets/bookmarks.js";
const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
const file = new File([new Uint8Array(10)], "test.bin", { lastModified: 123 });
assert.equal(
  sourceIdentity(file),
  sourceIdentity(
    new File([new Uint8Array(10)], "test.bin", { lastModified: 123 }),
  ),
);
assert.notEqual(
  sourceIdentity(file),
  sourceIdentity(
    new File([new Uint8Array(11)], "test.bin", { lastModified: 123 }),
  ),
);
const blob = new Blob([new Uint8Array(10)]);
assert.equal(sourceIdentity(blob), sourceIdentity(blob));
assert.notEqual(
  sourceIdentity(blob),
  sourceIdentity(new Blob([new Uint8Array(10)])),
);
const saved = saveBookmark(
  { name: "Region", source: sourceIdentity(file), offset: 2, length: 5 },
  storage,
);
assert.deepEqual(readBookmarks(storage), [saved]);
saveBookmark({ ...saved, name: "Renamed" }, storage);
assert.equal(readBookmarks(storage)[0].name, "Renamed");
assert.throws(() =>
  saveBookmark({ ...saved, id: undefined, name: "Renamed" }, storage),
);
assert.throws(() =>
  saveBookmark({ ...saved, offset: Number.MAX_SAFE_INTEGER }, storage),
);
const previous = values.get(storageKey);
assert.throws(
  () =>
    saveBookmark(
      { ...saved, name: "Fail" },
      {
        getItem: storage.getItem,
        setItem() {
          throw Error("Quota");
        },
      },
    ),
  /Quota/,
);
assert.equal(values.get(storageKey), previous);
deleteBookmark(saved.id, storage);
assert.deepEqual(readBookmarks(storage), []);
console.log(
  "Bookmarks pass: source metadata/session identity, exact ranges, owned CRUD, bounds and atomic failures.",
);
