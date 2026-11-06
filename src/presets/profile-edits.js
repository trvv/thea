/** Atomic edits of owned, serializable profiles. Navigation and preset-library state are separate. */
import { validateProfile } from "./profiles.js";

function mapReferences(value, transform) {
  if (Array.isArray(value))
    return value.map((entry) => mapReferences(entry, transform));
  if (!value || typeof value !== "object") return value;
  if (value.op === "ref") return transform(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      mapReferences(entry, transform),
    ]),
  );
}

export function renameFactor(profile, from, to) {
  const next = validateProfile(profile);
  if (!Object.hasOwn(next.recipes, from)) throw new TypeError("Unknown factor");
  if (typeof to !== "string" || !to.trim() || to.length > 64)
    throw new TypeError("Invalid factor name");
  if (from === to) return next;
  if (Object.hasOwn(next.recipes, to))
    throw new TypeError("Factor name already exists");
  next.recipes = Object.fromEntries(
    Object.entries(next.recipes).map(([name, expression]) => [
      name === from ? to : name,
      expression,
    ]),
  );
  const rewritten = mapReferences(next, (reference) =>
    reference.name === from ? { ...reference, name: to } : reference,
  );
  rewritten.configuration.recipes = rewritten.recipes;
  return validateProfile(rewritten);
}

export function deleteFactor(profile, name) {
  const next = validateProfile(profile);
  if (!Object.hasOwn(next.recipes, name)) throw new TypeError("Unknown factor");
  delete next.recipes[name];
  next.configuration.recipes = next.recipes;
  mapReferences(next, (reference) => {
    if (reference.name === name)
      throw new TypeError("Factor is still referenced");
    return reference;
  });
  return validateProfile(next);
}

/** Keep at most fifty owned profiles; record edits, not renders or source seeks. */
export function rememberEdit(history, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  history.past.push(validateProfile(before));
  if (history.past.length > 50) history.past.shift();
  history.future.length = 0;
  return true;
}

export function restoreEdit(history, current, direction) {
  if (!["undo", "redo"].includes(direction))
    throw new TypeError("Unknown edit direction");
  const from = direction === "undo" ? history.past : history.future;
  const to = direction === "undo" ? history.future : history.past;
  if (!from.length) return null;
  const next = validateProfile(from.at(-1));
  to.push(validateProfile(current));
  from.pop();
  return next;
}
