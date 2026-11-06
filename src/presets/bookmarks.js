/** Range bookmarks identify a source; reusable visualization presets remain source-independent. */
export const storageKey = "thea.bookmarks";
const sessions = new WeakMap();
const id = () => crypto.randomUUID();

export function sourceIdentity(source) {
  if (typeof source.name === "string" && Number.isFinite(source.lastModified))
    return JSON.stringify([
      "file",
      source.name,
      source.size,
      source.lastModified,
    ]);
  if (!sessions.has(source)) sessions.set(source, `session:${id()}`);
  return sessions.get(source);
}

function validate(entry) {
  if (
    !entry ||
    typeof entry.id !== "string" ||
    entry.id.length > 128 ||
    typeof entry.source !== "string" ||
    !entry.source ||
    entry.source.length > 4096 ||
    typeof entry.name !== "string" ||
    !entry.name.trim() ||
    entry.name.trim().length > 80 ||
    !Number.isSafeInteger(entry.offset) ||
    entry.offset < 0 ||
    !Number.isSafeInteger(entry.length) ||
    entry.length < 1 ||
    !Number.isSafeInteger(entry.offset + entry.length)
  )
    throw new TypeError("Invalid range bookmark");
  return {
    id: entry.id,
    name: entry.name.trim(),
    source: entry.source,
    offset: entry.offset,
    length: entry.length,
  };
}

export function readBookmarks(storage = globalThis.localStorage) {
  const json = storage?.getItem(storageKey);
  if (json == null) return [];
  if (json.length > 131072)
    throw new RangeError("Bookmark library exceeds its budget");
  const value = JSON.parse(json);
  if (
    value?.version !== 1 ||
    !Array.isArray(value.bookmarks) ||
    value.bookmarks.length > 128
  )
    throw new TypeError("Unsupported bookmark library");
  const entries = value.bookmarks.map(validate);
  if (
    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    new Set(entries.map((entry) => entry.name)).size !== entries.length
  )
    throw new TypeError("Duplicate bookmark identity or name");
  return entries;
}

export function saveBookmark(value, storage = globalThis.localStorage) {
  const entry = validate({ ...value, id: value.id ?? id() });
  const entries = readBookmarks(storage);
  if (entries.some((old) => old.name === entry.name && old.id !== entry.id))
    throw new TypeError("Bookmark name already exists");
  const existing = entries.findIndex((old) => old.id === entry.id);
  if (existing < 0) entries.push(entry);
  else entries[existing] = entry;
  if (!storage?.setItem) throw new Error("Bookmark storage is unavailable");
  const json = JSON.stringify({ version: 1, bookmarks: entries });
  if (entries.length > 128 || json.length > 131072)
    throw new RangeError("Bookmark library exceeds its budget");
  storage.setItem(storageKey, json);
  return entry;
}

export function deleteBookmark(id, storage = globalThis.localStorage) {
  const entries = readBookmarks(storage);
  if (!entries.some((entry) => entry.id === id))
    throw new TypeError("Unknown bookmark");
  storage.setItem(
    storageKey,
    JSON.stringify({
      version: 1,
      bookmarks: entries.filter((entry) => entry.id !== id),
    }),
  );
}
