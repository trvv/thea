/** A frequency-table configuration built from ordinary population, expression and appearance data. */
import {
  presetConfiguration,
  validateConfiguration,
} from "./point-configuration.js";
import { constant } from "./recipes.js";

export function byteFrequencyTable({
  representative = "first",
  text = true,
} = {}) {
  if (!["first", "last"].includes(representative))
    throw new TypeError("Symbol representative must be first or last");
  if (typeof text !== "boolean") throw new TypeError("Text must be boolean");
  const symbol = { op: "byte", offset: { op: "offset" } };
  const high = {
    op: "floor",
    input: { op: "divide", a: symbol, b: constant(16) },
  };
  const low = {
    op: "subtract",
    a: symbol,
    b: { op: "multiply", a: high, b: constant(16) },
  };
  const center = (input) => ({
    op: "divide",
    a: { op: "add", a: input, b: constant(0.5) },
    b: constant(16),
  });
  return {
    configuration: validateConfiguration({
      ...presetConfiguration("linear"),
      population: "symbols",
      tupleRepresentative: representative,
      sampleLimit: 256,
      sampling: "representative",
      position: [center(low), center(high), "none"],
      dimensions: {
        width: { start: 0, end: 16, step: 1 },
        height: { start: 0, end: 16, step: 1 },
      },
    }),
    appearance: {
      shape: "square",
      hue: "entropy",
      saturation: "none",
      lightness: "byteCount",
      opacity: "none",
      size: "none",
    },
    shaders: text ? ["hex"] : [],
  };
}
