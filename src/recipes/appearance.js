/**
 * Appearance compilation consumes canonical factors or compiled recipe-output slots.
 * @module appearance
 * @see docs/recipes.md
 */
import { validateRecipe } from "./recipes.js";
import { validateDensity } from "../render/density.js";
import {
  appearanceChannels as defaultChannels,
  appearanceChannelsFor,
  factorIndices,
  factorOptions,
} from "./factors.js";
export { factorIndices } from "./factors.js";
/**
 * Keep the compatibility accessor on the same catalog as position recipes; menu labels must not
 * introduce separate factor semantics.
 */
export function appearanceFactors() {
  return factorOptions;
}
/**
 * Translate preset defaults into mappings without forcing callers to allocate an explicit override
 * for unchanged settings.
 */
export function defaultAppearance(
  region,
  shaders = ["entropy", "brightness"],
  frequencyOpacity = false,
) {
  const mapping = {
    hue: shaders.includes("entropy") ? "entropy" : "none",
    saturation: "none",
    lightness: "none",
    opacity: "none",
    size: "none",
    shape: "square",
  };
  if (["linear", "hilbert", "hilbert3d"].includes(region)) {
    const hue = shaders.includes("entropy") && shaders.includes("brightness");
    mapping.hue = hue ? "entropy" : "none";
    mapping.lightness = shaders.includes("brightness")
      ? "value"
      : shaders.includes("entropy")
        ? "entropy"
        : "none";
  } else if (region === "dft") mapping.lightness = "amplitude";
  else if (frequencyOpacity && region === "trigraph")
    mapping.opacity = "tripleCount";
  else mapping.lightness = region === "trigraph" ? "tripleCount" : "pairCount";
  return mapping;
}
/**
 * Validate every channel against named definitions before state changes; clone expressions so a
 * subsequent caller mutation cannot bypass that boundary.
 */
export function validateAppearance(region, mapping, definitions = {}) {
  if (!mapping || !["square", "circle"].includes(mapping.shape))
    throw new TypeError("Invalid appearance mapping");
  const copy = { shape: mapping.shape };
  if (mapping.density !== undefined)
    copy.density = validateDensity(mapping.density);
  if (
    mapping.colorSpace !== undefined &&
    !["hsl", "rgb"].includes(mapping.colorSpace)
  )
    throw new TypeError("Unknown appearance color space");
  for (const channel of defaultChannels)
    copy[channel] =
      mapping[channel] === "none"
        ? "none"
        : validateRecipe(mapping[channel], definitions);
  if (mapping.colorSpace !== undefined) copy.colorSpace = mapping.colorSpace;
  if (mapping.colorSpace === "rgb")
    for (const channel of ["red", "green", "blue"])
      copy[channel] =
        mapping[channel] === "none"
          ? "none"
          : validateRecipe(mapping[channel], definitions);
  return copy;
}

/**
 * Map unbounded counts to a bounded opacity-compatible factor without a frame-dependent peak that
 * would make identical counts change meaning.
 */
export const occurrenceFactor = (count) =>
  1 - Math.exp(-0.25 * Math.log1p(count));
const compiled = new Map();
/**
 * Resolve canonical or compiled output slots once. Bounded color tables are eligible for any
 * mapping with at most two color inputs; non-quantized values use exact scalar conversion.
 */
export function compileAppearance(mapping) {
  const channels = appearanceChannelsFor(mapping);
  const rgb = mapping.colorSpace === "rgb";
  const numeric = channels.every(
    (channel) =>
      mapping[channel] === "none" || typeof mapping[channel] === "number",
  );
  const key = JSON.stringify([
    rgb ? "rgb" : "hsl",
    ...channels.map((channel) => mapping[channel]),
    mapping.shape,
  ]);
  if (compiled.has(key)) {
    const value = compiled.get(key);
    compiled.delete(key);
    compiled.set(key, value);
    return value;
  }
  if (!numeric) validateAppearance(undefined, mapping);
  const [h, s, l, a, z] = channels.map((channel) =>
    mapping[channel] === "none"
      ? -1
      : numeric
        ? mapping[channel]
        : factorIndices[mapping[channel]],
  );
  const hasColor = h >= 0 || s >= 0;
  const scalar = (values, out, offset = 0) => {
    if (rgb) {
      out[offset] = h < 0 ? 0 : Math.round(255 * values[h]);
      out[offset + 1] = s < 0 ? 0 : Math.round(255 * values[s]);
      out[offset + 2] = l < 0 ? 0 : Math.round(255 * values[l]);
      out[offset + 3] = a < 0 ? 255 : Math.round(255 * values[a]);
      return;
    }
    const hue = h < 0 ? 0 : values[h] * 300;
    const saturation = s < 0 ? (h < 0 ? 0 : 0.75) : values[s];
    const lightness =
      l < 0
        ? hasColor
          ? 0.5
          : 1
        : hasColor
          ? 0.15 + 0.7 * values[l]
          : values[l];
    const amplitude = saturation * Math.min(lightness, 1 - lightness);
    for (let channel = 0; channel < 3; channel++) {
      const k = ((channel === 0 ? 0 : channel === 1 ? 8 : 4) + hue / 30) % 12;
      out[offset + channel] = Math.round(
        255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
      );
    }
    out[offset + 3] = a < 0 ? 255 : Math.round(255 * values[a]);
  };
  const inputs = [...new Set([h, s, l, a].filter((index) => index >= 0))];
  let palette;
  const quantize = (value) => {
    const index = Math.round(value * 255);
    return index >= 0 &&
      index <= 255 &&
      value === (numeric ? Math.fround(index / 255) : index / 255)
      ? index
      : -1;
  };
  const rgba = (values, out, offset = 0) => {
    if (inputs.length > 2) return scalar(values, out, offset);
    const first = inputs.length ? quantize(values[inputs[0]]) : 0;
    const second = inputs.length > 1 ? quantize(values[inputs[1]]) : 0;
    if (first < 0 || second < 0) return scalar(values, out, offset);
    if (!palette) {
      const count = 256 ** inputs.length,
        factors = new Float64Array(Math.max(0, ...inputs) + 1);
      palette = new Uint8ClampedArray(count * 4);
      for (let i = 0; i < count; i++) {
        if (inputs.length)
          factors[inputs[0]] = numeric
            ? Math.fround((i & 255) / 255)
            : (i & 255) / 255;
        if (inputs.length > 1)
          factors[inputs[1]] = numeric
            ? Math.fround((i >>> 8) / 255)
            : (i >>> 8) / 255;
        scalar(factors, palette, i * 4);
      }
    }
    const p = (first + second * 256) * 4;
    out[offset] = palette[p];
    out[offset + 1] = palette[p + 1];
    out[offset + 2] = palette[p + 2];
    out[offset + 3] = palette[p + 3];
  };
  const result = {
    key,
    rgba,
    size: (values) => (z < 0 ? 1 : 0.5 + 1.5 * values[z]),
    shape: mapping.shape,
  };

  compiled.set(key, result);
  if (compiled.size > 16) compiled.delete(compiled.keys().next().value);
  return result;
}
