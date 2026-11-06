import assert from "node:assert/strict";
import * as library from "../src/presets/preset-library.js";
import { presetConfiguration } from "../src/recipes/point-configuration.js";
import { defaultAppearance } from "../src/recipes/appearance.js";
import { validateProfile } from "../src/presets/profiles.js";
const values = new Map(),
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
const profile = validateProfile({
  version: 3,
  region: "hilbert3d",
  configuration: presetConfiguration("hilbert3d"),
  recipes: { Neighbor: { op: "byte", offset: { op: "offset" } } },
  appearance: defaultAppearance("hilbert3d"),
  shaders: ["entropy", "brightness"],
  rotation: { yaw: 0.2, pitch: 0.3 },
  coordinateSystem: "cartesian",
  axes: [0, 1, 2],
  encoding: "ascii",
  blankSpaces: false,
  blankNulls: true,
  frequencyOpacity: false,
});
assert.deepEqual(library.readLibrary(storage), {
  version: 1,
  presets: [],
  selected: undefined,
});
const first = library.savePreset(
  { name: "  Cube  ", profile, barCount: 3 },
  storage,
);
assert.equal(first.name, "Cube");
assert.equal(library.readLibrary(storage).selected, first.id);
assert.equal(
  library.getPreset(first.id, storage).profile.configuration.position[2].input
    .op,
  "hilbert3d",
);
// Values returned to callers and their original inputs do not alias persisted snapshots.
first.profile.rotation.yaw = 1;
profile.rotation.yaw = 2;
assert.equal(library.getPreset(first.id, storage).profile.rotation.yaw, 0.2);
let unchanged = storage.getItem(library.storageKey);
for (const name of ["", " ", "x".repeat(81), "Cube"]) {
  assert.throws(() =>
    library.savePreset({ name, profile, barCount: 3 }, storage),
  );
  assert.equal(
    storage.getItem(library.storageKey),
    unchanged,
    "Invalid/colliding name changed the store",
  );
}
assert.throws(() =>
  library.savePreset(
    { name: "Invalid", profile: { ...profile, version: 99 } },
    storage,
  ),
);
assert.equal(storage.getItem(library.storageKey), unchanged);
const clone = library.duplicatePreset(first.id, "Cube Copy", storage);
assert.notEqual(clone.id, first.id);
assert.equal(clone.profile.rotation.yaw, 0.2);
assert.equal(
  library.readLibrary(storage).selected,
  first.id,
  "Duplicating changed selection",
);
library.renamePreset(clone.id, "Renamed", storage);
assert.equal(library.getPreset(clone.id, storage).name, "Renamed");
assert.throws(() => library.renamePreset(clone.id, "Cube", storage));
library.selectPreset(clone.id, storage);
assert.equal(library.readLibrary(storage).selected, clone.id);
const updated = library.savePreset(
  { id: clone.id, name: "Renamed", profile, barCount: 0 },
  storage,
);
assert.equal(updated.profile.rotation.yaw, 2);
assert.equal(library.getPreset(first.id, storage).barCount, 3);
assert.equal(library.getPreset(clone.id, storage).barCount, 0);
const exported = library.serializePreset(library.getPreset(clone.id, storage));
assert(!JSON.parse(exported).id, "Copied JSON exposed the local identity");
assert.deepEqual(library.parsePreset(exported), {
  name: "Renamed",
  profile,
  barCount: 0,
});
assert.deepEqual(library.parsePreset(JSON.stringify(profile)), {
  name: "Imported Preset",
  profile,
  barCount: 2,
});
assert.throws(() =>
  library.parsePreset(
    JSON.stringify({ version: 99, name: "Bad", profile, barCount: 0 }),
  ),
);
assert.throws(() => library.parsePreset("not JSON"));
assert.throws(() =>
  library.parsePreset(
    JSON.stringify({ ...JSON.parse(exported), barCount: -1 }),
  ),
);
for (const barCount of [-1, 1.5, NaN])
  assert.throws(() =>
    library.savePreset({ name: "Bad bars", profile, barCount }, storage),
  );
// Fresh reads preserve edits performed through another caller between operations.
const elsewhere = library.savePreset(
  { name: "Elsewhere", profile, barCount: 2 },
  storage,
);
library.renamePreset(first.id, "Original", storage);
assert.equal(library.getPreset(elsewhere.id, storage).name, "Elsewhere");
library.selectPreset(clone.id, storage);
library.deletePreset(clone.id, storage);
assert.equal(library.readLibrary(storage).selected, undefined);
assert.equal(library.readLibrary(storage).presets.length, 2);
assert.throws(() => library.getPreset(clone.id, storage));
assert.throws(
  () => library.savePreset({ id: clone.id, name: "Stale", profile }, storage),
  "Stale update recreated deleted preset",
);
library.selectPreset("builtin:hilbert", storage);
assert.equal(library.readLibrary(storage).selected, "builtin:hilbert");
assert.throws(() => library.selectPreset("builtin:unknown", storage));
// Unusual user names remain data rather than object keys.
const prototype = library.savePreset({ name: "__proto__", profile }, storage);
assert.equal(library.getPreset(prototype.id, storage).name, "__proto__");
assert.equal({}.profile, undefined);
// Existing profile migrations are applied inside a stored library too.
const legacy = {
  ...profile,
  version: 1,
  region: "linear",
  configuration: undefined,
  appearance: undefined,
  axes: [0, 1],
};
const migrated = library.savePreset(
  { name: "Legacy", profile: legacy },
  storage,
);
assert.equal(migrated.profile.version, 3);
assert.equal(migrated.profile.configuration.population, "bytes");
// Atomic storage failures and damaged libraries must never erase previously saved content.
unchanged = storage.getItem(library.storageKey);
const full = {
  getItem: storage.getItem,
  setItem() {
    throw new Error("quota exceeded");
  },
};
for (const action of [
  () => library.savePreset({ name: "Quota", profile }, full),
  () => library.renamePreset(first.id, "Other", full),
  () => library.duplicatePreset(first.id, "Other", full),
  () => library.deletePreset(first.id, full),
  () => library.selectPreset(first.id, full),
]) {
  assert.throws(action, /quota exceeded/);
  assert.equal(storage.getItem(library.storageKey), unchanged);
}
for (const corrupt of [
  "{broken",
  JSON.stringify({ version: 99, presets: [] }),
  JSON.stringify({
    version: 1,
    presets: [{ id: "saved:x", name: "Bad", profile: { version: 99 } }],
  }),
]) {
  storage.setItem(library.storageKey, corrupt);
  assert.throws(() => library.readLibrary(storage));
  assert.throws(() =>
    library.savePreset({ name: "Should not overwrite", profile }, storage),
  );
  assert.equal(storage.getItem(library.storageKey), corrupt);
}
const denied = {
  getItem() {
    throw new Error("storage denied");
  },
};
assert.throws(() => library.readLibrary(denied), /storage denied/);
assert.throws(
  () => library.savePreset({ name: "Unavailable", profile }, undefined),
  /storage is unavailable/,
);
console.log(
  "Preset library checks pass: durable CRUD, selected preset, copies/imports, snapshot ownership, migrations, collisions, stale edits, denied/full/corrupt storage.",
);
