import assert from "node:assert/strict";
import {
  renameFactor,
  deleteFactor,
  rememberEdit,
  restoreEdit,
} from "../profile-edits.js";
import { validateProfile } from "../profiles.js";
import { presetConfiguration } from "../point-configuration.js";
import { defaultAppearance } from "../appearance.js";

const recipes = {
  Value: "value",
  Dependent: { op: "ref", name: "Value" },
  Unused: "entropy",
};
const profile = validateProfile({
  version: 3,
  region: "linear",
  configuration: {
    ...presetConfiguration("linear"),
    recipes,
    position: [{ op: "ref", name: "Value" }, "row", "none"],
  },
  recipes,
  appearance: {
    ...defaultAppearance("linear"),
    hue: { op: "ref", name: "Dependent" },
  },
  shaders: [],
  coordinateSystem: "cartesian",
  axes: [0, 1],
  rotation: { yaw: 0, pitch: 0 },
  encoding: "ascii",
  blankSpaces: false,
  blankNulls: true,
  frequencyOpacity: false,
});
const saved = JSON.stringify(profile);
const renamed = renameFactor(profile, "Value", "New Value");
assert.equal(renamed.recipes.Dependent.name, "New Value");
assert.equal(renamed.configuration.position[0].name, "New Value");
assert.equal(renamed.configuration.recipes.Dependent.name, "New Value");
assert(!Object.hasOwn(renamed.recipes, "Value"));
assert.equal(JSON.stringify(profile), saved);
for (const target of ["", " ", "Unused", "x".repeat(65)])
  assert.throws(() => renameFactor(profile, "Value", target));
assert.throws(() => deleteFactor(profile, "Value"), /referenced/);
assert.throws(() => deleteFactor(profile, "Dependent"), /referenced/);
const removed = deleteFactor(profile, "Unused");
assert(!Object.hasOwn(removed.recipes, "Unused"));
assert.equal(JSON.stringify(profile), saved);
const prototypeName = renameFactor(profile, "Value", "__proto__");
assert(Object.hasOwn(prototypeName.recipes, "__proto__"));
assert.equal(prototypeName.recipes.Dependent.name, "__proto__");
const history = { past: [], future: [] };
assert.equal(rememberEdit(history, profile, profile), false);
assert(rememberEdit(history, profile, renamed));
const undo = restoreEdit(history, renamed, "undo");
assert.deepEqual(undo, profile);
assert.deepEqual(restoreEdit(history, profile, "redo"), renamed);
assert.equal(restoreEdit(history, renamed, "redo"), null);
assert.equal(restoreEdit(history, renamed, "undo").recipes.Value, "value");
rememberEdit(history, profile, removed);
assert.equal(history.future.length, 0);
for (let i = 0; i < 60; i++) rememberEdit(history, profile, renamed);
assert.equal(history.past.length, 50);
assert.throws(() => restoreEdit(history, profile, "unknown"));
console.log(
  "Profile edits pass: atomic indirect rename, referenced deletion rejection, prototype-safe names, owned bounded undo/redo and unchanged failures.",
);
