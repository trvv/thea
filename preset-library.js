/** Named, source-independent presets. Writes replace one validated localStorage value atomically. */
import { validateProfile } from "./profiles.js";
export const storageKey = "thea.presets";
const builtins = new Set([
  "linear",
  "hilbert",
  "hilbert3d",
  "digraph",
  "dft",
  "trigraph",
]);
const nameOf = (value) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    throw new TypeError("Preset names must contain 1–80 characters.");
  return value.trim();
};
const barsOf = (value) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError("Invalid preset bar count.");
  return value;
};
const payload = (value) => ({
  name: nameOf(value.name),
  profile: validateProfile(value.profile),
  barCount: barsOf(value.barCount ?? 2),
});
const idOf = () =>
  `saved:${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("")}`;
function validateLibrary(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.presets))
    throw new TypeError("Unsupported or damaged preset library.");
  const ids = new Set(),
    names = new Set();
  const presets = value.presets.map((entry) => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !entry.id.startsWith("saved:") ||
      entry.id.length > 128 ||
      ids.has(entry.id)
    )
      throw new TypeError("Invalid or duplicate preset ID.");
    const validated = { id: entry.id, ...payload(entry) };
    if (names.has(validated.name))
      throw new TypeError("Duplicate preset name.");
    ids.add(entry.id);
    names.add(validated.name);
    return validated;
  });
  const selected =
    ids.has(value.selected) ||
    (typeof value.selected === "string" &&
      value.selected.startsWith("builtin:") &&
      builtins.has(value.selected.slice(8)))
      ? value.selected
      : undefined;
  return { version: 1, presets, selected };
}
export function readLibrary(storage = globalThis.localStorage) {
  const json = storage?.getItem(storageKey);
  return json == null
    ? { version: 1, presets: [], selected: undefined }
    : validateLibrary(JSON.parse(json));
}
function writeLibrary(value, storage) {
  const validated = validateLibrary(value);
  if (!storage) throw new Error("Preset storage is unavailable.");
  storage.setItem(storageKey, JSON.stringify(validated));
  return validated;
}
function find(library, id) {
  const entry = library.presets.find((entry) => entry.id === id);
  if (!entry) throw new Error("This saved preset no longer exists.");
  return entry;
}
function unique(library, name, id) {
  if (library.presets.some((entry) => entry.name === name && entry.id !== id))
    throw new Error(`A preset named “${name}” already exists.`);
}
/** Create a snapshot or explicitly update an existing entry. Save As never overwrites a name. */
export function savePreset(value, storage = globalThis.localStorage) {
  const library = readLibrary(storage),
    entry = { id: value.id ?? idOf(), ...payload(value) };
  if (value.id !== undefined) find(library, value.id);
  unique(library, entry.name, entry.id);
  const presets =
    value.id === undefined
      ? [...library.presets, entry]
      : library.presets.map((old) => (old.id === entry.id ? entry : old));
  writeLibrary({ ...library, presets, selected: entry.id }, storage);
  return entry;
}
export function getPreset(id, storage = globalThis.localStorage) {
  return find(readLibrary(storage), id);
}
export function selectPreset(id, storage = globalThis.localStorage) {
  const library = readLibrary(storage);
  const entry =
    id.startsWith("builtin:") && builtins.has(id.slice(8))
      ? undefined
      : find(library, id);
  // Built-ins remain usable in nonbrowser hosts with no storage; saving custom data still fails.
  if (storage) writeLibrary({ ...library, selected: id }, storage);
  return entry;
}
export function duplicatePreset(id, name, storage = globalThis.localStorage) {
  const library = readLibrary(storage),
    entry = { ...find(library, id), id: idOf(), name: nameOf(name) };
  unique(library, entry.name);
  writeLibrary({ ...library, presets: [...library.presets, entry] }, storage);
  return structuredClone(entry);
}
export function renamePreset(id, name, storage = globalThis.localStorage) {
  const library = readLibrary(storage),
    entry = { ...find(library, id), name: nameOf(name) };
  unique(library, entry.name, id);
  writeLibrary(
    {
      ...library,
      presets: library.presets.map((old) => (old.id === id ? entry : old)),
    },
    storage,
  );
  return structuredClone(entry);
}
export function deletePreset(id, storage = globalThis.localStorage) {
  const library = readLibrary(storage);
  find(library, id);
  writeLibrary(
    {
      ...library,
      presets: library.presets.filter((entry) => entry.id !== id),
      selected: library.selected === id ? undefined : library.selected,
    },
    storage,
  );
}
/** Clipboard payloads omit local IDs. Bare existing versioned profiles are accepted on import. */
export function serializePreset(value) {
  return JSON.stringify({ version: 1, ...payload(value) }, null, 2);
}
export function parsePreset(json) {
  const value = JSON.parse(json);
  if (value?.profile !== undefined) {
    if (value.version !== 1)
      throw new TypeError("Unsupported copied preset version.");
    return payload(value);
  }
  return {
    name: "Imported Preset",
    profile: validateProfile(value),
    barCount: 2,
  };
}
