/** Curve presets contain ordinary coordinate expressions and remain freely editable. */
import { hCurveCoordinate, mortonCoordinate } from "./recipes.js";
import {
  presetConfiguration,
  validateConfiguration,
} from "./point-configuration.js";
import { defaultAppearance } from "./appearance.js";

export const curveTemplates = ["hcurve", "morton2d", "morton3d"];
export function curveTemplate(kind) {
  if (!curveTemplates.includes(kind))
    throw new TypeError("Unknown curve template");
  const dimensions = kind === "morton3d" ? 3 : 2;
  const position = Array.from({ length: dimensions }, (_, axis) =>
    kind === "hcurve"
      ? hCurveCoordinate(axis)
      : mortonCoordinate(axis, { op: "pointIndex" }, 0, dimensions),
  );
  if (dimensions === 2) position.push("none");
  return {
    configuration: validateConfiguration({
      ...presetConfiguration(dimensions === 3 ? "hilbert3d" : "hilbert"),
      position,
    }),
    appearance: defaultAppearance("hilbert"),
    shaders: ["entropy", "brightness"],
  };
}
